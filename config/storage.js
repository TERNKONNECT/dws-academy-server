import path from "path";
import s3 from "./s3.js";
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
    const result = await s3.upload(params).promise();
    return {
      url: result.Location,
      id: result.Key,
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

/**
 * Handles file deletion by switching between S3 and Cloudinary
 * @param {string} id - The provider-specific ID (Key for S3, public_id for Cloudinary)
 * @param {string} resourceType - 'image' or 'video' (required for Cloudinary)
 */
export const deleteFile = async (id, resourceType = "image") => {
  if (process.env.NODE_ENV === "production" && s3) {
    return s3
      .deleteObject({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: id,
      })
      .promise();
  }

  return cloudinary.uploader.destroy(id, { resource_type: resourceType });
};

export const getFileUrl = async (id, fallbackUrl = "") => {
  if (!id) return fallbackUrl;
  if (process.env.NODE_ENV !== "production" || !s3) return fallbackUrl;

  return s3.getSignedUrlPromise("getObject", {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: id,
    Expires: 60 * 60,
  });
};
