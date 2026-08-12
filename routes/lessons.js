import express from "express";
import Lesson from "../models/Lesson.js";
import Module from "../models/Module.js";
import { protect, optionalAuth } from "../middleware/auth.js";
import {
  requireCourseAccess,
  requireCourseOwnership,
} from "../middleware/courseAccess.js";
import { documentUpload, videoUpload } from "../middleware/uploads.js";
import {
  createUploadUrl,
  uploadFile,
  deleteFile,
  getFileUrl,
} from "../config/storage.js";

const router = express.Router({ mergeParams: true });

// Lesson bodies and signed media URLs are the product. Gate every read.
router.use(optionalAuth);

// Fields a lesson write may set. Keeps `moduleId`, `id`, and the Cloudinary/S3
// pointers out of reach of a request body.
const WRITABLE_LESSON_FIELDS = ["title", "content", "duration", "order", "type"];

function pickLessonFields(body) {
  const out = {};
  for (const field of WRITABLE_LESSON_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  return out;
}

async function serializeLesson(lesson) {
  const data = lesson.toJSON ? lesson.toJSON() : lesson;
  return {
    ...data,
    videoUrl:
      data.type === "video"
        ? await getFileUrl(data.cloudinaryId, data.videoUrl)
        : data.videoUrl,
    documentUrl: await getFileUrl(data.documentCloudinaryId, data.documentUrl),
    transcriptUrl: await getFileUrl(
      data.transcriptCloudinaryId,
      data.transcriptUrl,
    ),
  };
}

/** Confirms the module named in the URL really belongs to the resolved course. */
async function moduleInCourse(req, res) {
  const mod = await Module.findOne({
    where: { id: req.params.moduleId, courseId: req.course.id },
  });
  if (!mod) {
    res.status(404).json({ error: "Module not found" });
    return null;
  }
  return mod;
}

// GET all lessons for a module
router.get("/", requireCourseAccess, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const lessons = await Lesson.findAll({
      where: { moduleId: req.params.moduleId },
      order: [["order", "ASC"]],
    });
    res.json(await Promise.all(lessons.map(serializeLesson)));
  } catch (err) {
    next(err);
  }
});

// GET single lesson
router.get("/:id", requireCourseAccess, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    res.json(await serializeLesson(lesson));
  } catch (err) {
    next(err);
  }
});

// POST create text lesson
router.post("/text", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const { title, content, order } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const lesson = await Lesson.create({
      moduleId: req.params.moduleId,
      title,
      type: "text",
      content,
      order,
    });
    res.status(201).json(lesson);
  } catch (err) {
    next(err);
  }
});

// POST presigned URL for a direct-to-S3 video upload
router.post(
  "/video-upload-url",
  protect,
  requireCourseOwnership,
  async (req, res, next) => {
    try {
      if (!(await moduleInCourse(req, res))) return;

      const { filename, contentType } = req.body;
      if (!filename)
        return res.status(400).json({ error: "Filename is required" });

      const upload = await createUploadUrl({
        filename,
        contentType,
        folder: "lms/lessons",
      });

      res.json(upload);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/video",
  protect,
  requireCourseOwnership,
  videoUpload.single("video"),
  async (req, res, next) => {
    try {
      if (!(await moduleInCourse(req, res))) return;
      if (!req.file)
        return res.status(400).json({ error: "No video file uploaded" });

      const { title, duration, order } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });

      const fileData = await uploadFile(req.file, "lms/lessons");
      const lesson = await Lesson.create({
        moduleId: req.params.moduleId,
        title,
        type: "video",
        videoUrl: fileData.url,
        cloudinaryId: fileData.id,
        duration,
        order,
      });
      res.status(201).json(await serializeLesson(lesson));
    } catch (err) {
      next(err);
    }
  },
);

// PUT update lesson
router.put("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    await lesson.update(pickLessonFields(req.body));
    res.json(await serializeLesson(lesson));
  } catch (err) {
    next(err);
  }
});

// POST upload lesson document
router.post(
  "/:id/document",
  protect,
  requireCourseOwnership,
  documentUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!(await moduleInCourse(req, res))) return;

      const lesson = await Lesson.findOne({
        where: { id: req.params.id, moduleId: req.params.moduleId },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      if (!req.file)
        return res.status(400).json({ error: "No document file uploaded" });

      if (lesson.documentCloudinaryId) {
        await deleteFile(lesson.documentCloudinaryId, "raw");
      }

      const fileData = await uploadFile(req.file, "lms/documents");
      await lesson.update({
        documentUrl: fileData.url,
        documentCloudinaryId: fileData.id,
      });

      res.json(await serializeLesson(lesson));
    } catch (err) {
      next(err);
    }
  },
);

// POST upload lesson transcript
router.post(
  "/:id/transcript",
  protect,
  requireCourseOwnership,
  documentUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!(await moduleInCourse(req, res))) return;

      const lesson = await Lesson.findOne({
        where: { id: req.params.id, moduleId: req.params.moduleId },
      });
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });
      if (!req.file)
        return res.status(400).json({ error: "No transcript file uploaded" });

      if (lesson.transcriptCloudinaryId) {
        await deleteFile(lesson.transcriptCloudinaryId, "raw");
      }

      const fileData = await uploadFile(req.file, "lms/transcripts");
      await lesson.update({
        transcriptUrl: fileData.url,
        transcriptCloudinaryId: fileData.id,
      });

      res.json(await serializeLesson(lesson));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE lesson
router.delete("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    if (lesson.cloudinaryId) {
      await deleteFile(lesson.cloudinaryId, "video");
    }
    if (lesson.documentCloudinaryId) {
      await deleteFile(lesson.documentCloudinaryId, "raw");
    }
    if (lesson.transcriptCloudinaryId) {
      await deleteFile(lesson.transcriptCloudinaryId, "raw");
    }

    await lesson.destroy();
    res.json({ message: "Lesson deleted" });
  } catch (err) {
    next(err);
  }
});

// POST create video lesson from a URL already uploaded to S3/Cloudinary
router.post("/video-url", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    if (!(await moduleInCourse(req, res))) return;

    const { title, videoUrl, cloudinaryId, duration, order } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!videoUrl)
      return res.status(400).json({ error: "Video URL is required" });

    const lesson = await Lesson.create({
      moduleId: req.params.moduleId,
      title,
      type: "video",
      videoUrl,
      cloudinaryId: cloudinaryId || "",
      duration,
      order,
    });
    res.status(201).json(await serializeLesson(lesson));
  } catch (err) {
    next(err);
  }
});

export default router;
