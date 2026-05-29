import s3 from '../config/s3.js';
import cloudinary from '../config/cloudinary.js';

/**
 * Handles file uploads by switching between S3 (Production) and Cloudinary (Development)
 * @param {Object} file - The file object from Multer
 */
export const uploadFile = async (file) => {
  if (process.env.NODE_ENV === 'production' && s3) {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `${Date.now()}-${file.originalname}`,
      Body: file.buffer,
    };
    const result = await s3.upload(params).promise();
    return {
      url: result.Location,
      id: result.Key,
      provider: 's3'
    };
  } else {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "auto" },
        (error, result) => (error ? reject(error) : resolve({
          url: result.secure_url,
          id: result.public_id,
          provider: 'cloudinary'
        }))
      );
      uploadStream.end(file.buffer);
    });
  }
};

/**
 * Handles file deletion by switching between S3 and Cloudinary
 * @param {string} id - The provider-specific ID (Key for S3, public_id for Cloudinary)
 * @param {string} resourceType - 'image' or 'video' (required for Cloudinary)
 */
export const deleteFile = async (id, resourceType = 'image') => {
  if (process.env.NODE_ENV === 'production' && s3) {
    return s3.deleteObject({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: id,
    }).promise();
  } else {
    return cloudinary.uploader.destroy(id, { resource_type: resourceType });
  }
};