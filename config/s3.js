import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_ACCESS_KEY,
  region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
  signatureVersion: "v4",
});

export default s3;
