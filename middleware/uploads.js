import multer from "multer";

/**
 * Multer buffers the whole file in memory, so an unbounded upload is a way to take
 * the process down — on Lambda or a small Vercel function one large video is enough.
 * Every upload route goes through one of these, each with a ceiling and a mimetype
 * allowlist.
 *
 * Large media should really use the presigned-URL path (`createUploadUrl`) and go to
 * S3 directly; these limits are the backstop for the routes that still proxy.
 */

const MB = 1024 * 1024;

function memoryUpload({ fileSize, allowed, label }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize, files: 1 },
    fileFilter(_req, file, cb) {
      if (allowed.some((prefix) => file.mimetype?.startsWith(prefix))) {
        return cb(null, true);
      }
      const err = new Error(`Only ${label} files are accepted`);
      err.status = 400;
      cb(err);
    },
  });
}

export const imageUpload = memoryUpload({
  fileSize: 5 * MB,
  allowed: ["image/"],
  label: "image",
});

export const videoUpload = memoryUpload({
  fileSize: 200 * MB,
  allowed: ["video/"],
  label: "video",
});

export const documentUpload = memoryUpload({
  fileSize: 25 * MB,
  allowed: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "text/",
  ],
  label: "document",
});

/**
 * Turns multer's own errors into clean 400s instead of 500s.
 */
export function uploadErrorHandler(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "That file is too large."
        : "That upload could not be accepted.";
    return res.status(400).json({ error: message });
  }
  next(err);
}
