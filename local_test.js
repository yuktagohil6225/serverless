const app = require('./app');

// Craft an SNS event payload
const snsPayload = {
  Records: [
    {
      Sns: {
        Message: JSON.stringify({
          userEmail: 'yuktabag@gmail.com',
          message: 'Submission deadline has passed.',
          // other relevant data...
        })
      }
    }
  ]
};

// Trigger the Lambda function handler with the SNS event payload
app.handler(snsPayload, null)
  .then(result => {
    console.log('Lambda execution result:', result);
  })
  .catch(error => {
    console.error('Lambda execution error:', error);
  });
