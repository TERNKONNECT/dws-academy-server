import express from "express";
import multer from "multer";
import Lesson from "../models/Lesson.js";
import Module from "../models/Module.js";
import { protect, adminOnly } from "../middleware/auth.js";
import {
  createUploadUrl,
  uploadFile,
  deleteFile,
  getFileUrl,
} from "../config/storage.js";

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

async function serializeLesson(lesson) {
  const data = lesson.toJSON ? lesson.toJSON() : lesson;
  return {
    ...data,
    videoUrl:
      data.type === "video"
        ? await getFileUrl(data.cloudinaryId, data.videoUrl)
        : data.videoUrl,
  };
}

// GET all lessons for a module
router.get("/", async (req, res) => {
  try {
    const lessons = await Lesson.findAll({
      where: { moduleId: req.params.moduleId },
      order: [["order", "ASC"]],
    });
    res.json(await Promise.all(lessons.map(serializeLesson)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single lesson
router.get("/:id", async (req, res) => {
  try {
    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    res.json(await serializeLesson(lesson));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create text lesson
router.post("/text", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findByPk(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

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
    res.status(500).json({ error: err.message });
  }
});

// POST create video lesson
router.post("/video-upload-url", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findByPk(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

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
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/video",
  protect,
  adminOnly,
  upload.single("video"),
  async (req, res) => {
    try {
      const mod = await Module.findByPk(req.params.moduleId);
      if (!mod) return res.status(404).json({ error: "Module not found" });
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
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT update lesson
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });
    await lesson.update(req.body);
    res.json(await serializeLesson(lesson));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE lesson
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const lesson = await Lesson.findOne({
      where: { id: req.params.id, moduleId: req.params.moduleId },
    });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    if (lesson.cloudinaryId) {
      await deleteFile(lesson.cloudinaryId, "video");
    }

    await lesson.destroy();
    res.json({ message: "Lesson deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create video lesson from URL (used when frontend uploads directly to Cloudinary)
router.post("/video-url", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findByPk(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

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
    res.status(500).json({ error: err.message });
  }
});

export default router;
