import AWS from 'aws-sdk';

const s3Config = {
  region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
  signatureVersion: "v4",
};

const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_ACCESS_KEY;
const sessionToken = process.env.AWS_SESSION_TOKEN;

if (accessKeyId && secretAccessKey) {
  s3Config.accessKeyId = accessKeyId;
  s3Config.secretAccessKey = secretAccessKey;
  if (sessionToken) {
    s3Config.sessionToken = sessionToken;
  }
}

const s3 = new AWS.S3(s3Config);

export default s3;
