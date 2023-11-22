const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const { Storage } = require('@google-cloud/storage');

exports.handler = async (event) => {
    const { releaseUrl, userEmail } = event;

    // Setup AWS DynamoDB and Google Cloud Storage
    const dynamoDB = new AWS.DynamoDB();
    const storage = new Storage();

    try {
        // Download the release from GitHub
        const response = await fetch(releaseUrl);
        const releaseData = await response.buffer();

        // Store the release in Google Cloud Storage
        const bucketName = 'ygohil-bucket';
        const bucket = storage.bucket(bucketName);
        const fileName = 'release.zip';
        const file = bucket.file(fileName);

        await file.save(releaseData, {
            resumable: false,
            validation: 'md5',
        });

        // Email the user about the status of the download using SendGrid
        const sendGridApiKey = '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';
        const sendGridUrl = 'https://api.sendgrid.com/v3/mail/send';

        const mailOptions = {
            personalizations: [
                {
                    to: [{ email: userEmail }],
                    subject: 'Download Status',
                }
            ],
            from: { email: 'your-email@example.com' },
            content: [
                {
                    type: 'text/plain',
                    value: 'The download is complete.'
                }
            ]
        };

        await fetch(sendGridUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${sendGridApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mailOptions)
        });

        // Track the emails sent in DynamoDB
        const tableName = 'yukta-table';
        const params = {
            TableName: tableName,
            Item: {
                'Email': { S: userEmail },
                'Timestamp': { N: Date.now().toString() },
            }
        };

        await dynamoDB.putItem(params).promise();

        return {
            statusCode: 200,
            body: 'Process completed successfully'
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: 'Process failed'
        };
    }
};
