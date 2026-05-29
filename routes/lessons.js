import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import Lesson from "../models/Lesson.js";
import Module from "../models/Module.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router({ mergeParams: true });

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "lms/lessons",
    resource_type: "video",
    allowed_formats: ["mp4", "mkv", "webm", "mov"],
  },
});
const upload = multer({ storage });

// GET all lessons for a module
router.get("/", async (req, res) => {
  try {
    const lessons = await Lesson.findAll({
      where: { moduleId: req.params.moduleId },
      order: [["order", "ASC"]],
    });
    res.json(lessons);
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
    res.json(lesson);
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

      const lesson = await Lesson.create({
        moduleId: req.params.moduleId,
        title,
        type: "video",
        videoUrl: req.file.path,
        cloudinaryId: req.file.filename,
        duration,
        order,
      });
      res.status(201).json(lesson);
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
    res.json(lesson);
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
      await cloudinary.uploader.destroy(lesson.cloudinaryId, {
        resource_type: "video",
      });
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
    res.status(201).json(lesson);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
