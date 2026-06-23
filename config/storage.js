import path from "path";
import s3 from "./s3.js";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import cloudinary from "./cloudinary.js";

/**
 * Handles file uploads by switching between S3 (Production) and Cloudinary (Development)
 * @param {Object} file - The file object from Multer
 * @param {string} folder - Storage folder/prefix
 */
export const uploadFile = async (file, folder = "uploads") => {
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${folder}/${Date.now()}-${safeName}`;

  if (process.env.NODE_ENV === "production" && s3) {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };
    const command = new PutObjectCommand(params);
    await s3.send(command);
    
    const region = process.env.AWS_S3_REGION || process.env.AWS_REGION || "eu-north-1";
    return {
      url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`,
      id: key,
      provider: "s3",
    };
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",
        public_id: path.parse(safeName).name,
        unique_filename: true,
      },
      (error, result) =>
        error
          ? reject(error)
          : resolve({
              url: result.secure_url,
              id: result.public_id,
              provider: "cloudinary",
            }),
    );
    uploadStream.end(file.buffer);
  });
};

export const createUploadUrl = async ({
  filename,
  contentType,
  folder = "uploads",
}) => {
  if (!s3 || !process.env.AWS_S3_BUCKET_NAME) {
    throw new Error("S3 upload storage is not configured");
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${folder}/${Date.now()}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  });
  
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  const region = process.env.AWS_S3_REGION || process.env.AWS_REGION || "eu-north-1";
  return {
    uploadUrl,
    key,
    url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`,
  };
};

/**
 * Handles file deletion by switching between S3 and Cloudinary
 * @param {string} id - The provider-specific ID (Key for S3, public_id for Cloudinary)
 * @param {string} resourceType - 'image' or 'video' (required for Cloudinary)
 */
export const deleteFile = async (id, resourceType = "image") => {
  if (process.env.NODE_ENV === "production" && s3) {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: id,
    });
    return s3.send(command);
  }

  return cloudinary.uploader.destroy(id, { resource_type: resourceType });
};

export const getFileUrl = async (id, fallbackUrl = "") => {
  if (!id) return fallbackUrl;

  const isS3Url = fallbackUrl && fallbackUrl.includes("amazonaws.com");
  if ((process.env.NODE_ENV === "production" || isS3Url) && s3) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: id,
      });
      return await getSignedUrl(s3, command, { expiresIn: 3600 });
    } catch (err) {
      console.error("Failed to sign S3 URL:", err);
      return fallbackUrl;
    }
  }

  return fallbackUrl;
};
