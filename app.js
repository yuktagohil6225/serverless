const AWS = require('aws-sdk');
const https = require('https');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');

const sns = new AWS.SNS();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
// Access the environment variable containing the key JSON
const serviceAccountKey = JSON.parse(Buffer.from(process.env.GOOGLE_ACCESS_KEY, 'base64').toString('utf-8'));

// Authenticate with Google Cloud Storage
const storage = new Storage({
  projectId: serviceAccountKey.project_id,
  credentials: {
    client_email: serviceAccountKey.client_email,
    private_key: serviceAccountKey.private_key,
  },
});


// AWS.config.update({ region: 'us-east-2' });
console.log("Started");
exports.handler = async (event, context) => {
  try {
    const currentRegion = context.invokedFunctionArn.split(':')[3]; // Extracting region from the Lambda ARN

    AWS.config.update({ region: currentRegion });
    let snsMessage;
    let submissionId = uuidv4();

    // Check if Sns.Message is already a JSON string
    if (typeof event.Records[0].Sns.Message === 'string') {
      snsMessage = JSON.parse(event.Records[0].Sns.Message);
    } else {
      snsMessage = event.Records[0].Sns.Message;
    }
    const userEmail = snsMessage.email;
    const message = snsMessage.usermessage;
    // Check if submission attempts have exceeded
    if (message === 'Submission deadline has passed.') {
      await sendEmail(userEmail, 'Submission Failed: Submission deadline has passed.', '', submissionId);
      return;
    } else if (message === 'Invalid, Empty or non-ZIP GitHub release URL.') {
      await sendEmail(userEmail, 'Submission Failed: Invalid, Empty or non-ZIP GitHub release URL.', '', submissionId);
      return;
    } else if (message === 'Exceeded maximum submission attempts.') {
      await sendEmail(userEmail, 'Submission Failed: Exceeded maximum submission attempts.', '', submissionId);
      return;
    }

    const githubReleaseURL = snsMessage.submission_url;
    
    const bucketName = 'ygohil-bucket'; // Replace with your GCS bucket name

    const files = await downloadFromGitHub(githubReleaseURL, userEmail, submissionId);
    // await storeInGCS(files, bucketName, userEmail);

    const bucketPath = await storeInGCS(files, bucketName, userEmail, submissionId);
    
    
    const emailStatus = 'Submission Successful. Downloaded branch content and stored in GCS';
    
    // Send email status
    await sendEmail(userEmail, emailStatus, bucketPath, submissionId);

    // Track email in DynamoDB
    await trackEmailSent(userEmail, 'Sent', submissionId);

    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    await trackEmailSent(userEmail, 'Failed', submissionId);
    console.log('Find the error around this block.'); // Log to indicate where to find potential errors
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

async function downloadFromGitHub(githubReleaseURL, userEmail, submissionId) {
  try {
    const response = await axios.get(githubReleaseURL, { responseType: 'arraybuffer' });
    const zip = new AdmZip(response.data);

    // Extract the content of the ZIP file
    const zipEntries = zip.getEntries();

    // Process the extracted files
    const filesToDownload = zipEntries.map(entry => ({
      name: entry.entryName, // Assuming entry.entryName gives the file name
      content: entry.getData() // Get the content of the file
    }));

    return filesToDownload; // Return an array of file objects with name and content
  } catch (error) {
    console.error('Error downloading content from GitHub:', error);
    // await trackEmailSent(userEmail, 'Failed', submissionId);
    throw error;
  }
}

async function storeInGCS(files, bucketName, userEmail, submissionId) {
  try {
    const bucket = storage.bucket(bucketName);
    const userFolder = userEmail.replace('@', '_').replace('.', '_');

    const uniqueFileName = `${userFolder}/${uuidv4()}.zip`; // Unique name for the zip file

    const zip = new AdmZip();
    files.forEach(file => {
      zip.addFile(file.name, file.content, '', 0o644); // Adding each file to the zip object
    });

    const zipBuffer = zip.toBuffer(); // Get the buffer of the zip object
    
    const gcsFile = bucket.file(uniqueFileName);
    await gcsFile.save(zipBuffer);

    // await Promise.all(files.map(async file => {
    //   const gcsFile = bucket.file(file.name);
    //   await gcsFile.save(file.content);
    // }));
    return uniqueFileName; 
    console.log('Files uploaded to GCS');
  } catch (error) {
    console.error('Error storing files in GCS:', error);
    // await trackEmailSent(userEmail, 'Failed', submissionId);
    throw error;
  }
}

  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey('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'); // Replace with your SendGrid API key
  
  async function sendEmail(userEmail, status, bucketPath, submissionId) {
    const bucketURL = `gs://ygohil-bucket/${bucketPath}`;
    const msg = {
      to: userEmail,
      from: 'info@ygohil.me', // Replace with your verified SendGrid email
      subject: 'Submission Status',
      text: `Submission status: ${status}\nGCS Bucket Path: ${bucketURL}`
    };
  
    try {
      await sgMail.send(msg);
      await trackEmailSent(userEmail, 'Sent', submissionId);
      console.log(`Email sent to ${userEmail} with status: ${status}`);
    } catch (error) {
      console.error('Error sending email:', error);
      await trackEmailSent(userEmail, 'Failed', submissionId);
      throw error;
    }
  }
  
  async function trackEmailSent(userEmail, status, submissionId) {

    console.log(`Tracking email for user: ${userEmail} with status: ${status}`);
    // Logic to track email in DynamoDB
    const params = {
      TableName: 'yukta-table', // Replace with your DynamoDB table name
      Item: {
        Email: userEmail,
        timestamp: new Date().toISOString(),
        SubmissionId: submissionId,
        Status: status,
      }
    };
    console.log(`Attempting to put value '${status}' into 'Status' attribute.`);
    await dynamoDB.put(params).promise();
  
    console.log(`Email sent by ${userEmail} tracked in DynamoDB`);
  }