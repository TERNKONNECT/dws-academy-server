import { S3Client } from '@aws-sdk/client-s3';

const s3Config = {
  region: process.env.AWS_S3_REGION || process.env.AWS_REGION,
};

const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_ACCESS_KEY;
const sessionToken = process.env.AWS_SESSION_TOKEN;

if (accessKeyId && secretAccessKey) {
  s3Config.credentials = {
    accessKeyId,
    secretAccessKey,
  };
  if (sessionToken) {
    s3Config.credentials.sessionToken = sessionToken;
  }
}

const s3 = new S3Client(s3Config);

export default s3;
