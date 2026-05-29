import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import User from "../models/User.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "lms/intro-videos",
    resource_type: "video",
    allowed_formats: ["mp4", "mkv", "webm", "mov"],
  },
});
const upload = multer({ storage });

// GET all courses
router.get("/", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let where = {};
    let isSuperAdmin = false;

    if (authHeader) {
      try {
        const jwt = await import("jsonwebtoken");
        const decoded = jwt.default.verify(
          authHeader.split(" ")[1],
          process.env.JWT_SECRET,
        );
        if (decoded.role === "admin") {
          where = { createdBy: decoded.id };
        } else if (decoded.role === "super-admin") {
          isSuperAdmin = true;
        }
      } catch {
        where = { status: "published" };
      }
    } else {
      where = { status: "published" };
    }

    const courses = await Course.findAll({
      where,
      // Include instructor name only for super-admin
      include: isSuperAdmin
        ? [
            {
              model: User,
              as: "instructor",
              attributes: ["id", "name", "email"],
            },
          ]
        : [],
      order: [["createdAt", "DESC"]],
    });

    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single course with full structure
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const modules = await Module.findAll({
      where: { courseId: req.params.id },
      order: [["order", "ASC"]],
    });

    const modulesWithContent = await Promise.all(
      modules.map(async (mod) => {
        const [lessons, quiz] = await Promise.all([
          Lesson.findAll({
            where: { moduleId: mod.id },
            order: [["order", "ASC"]],
          }),
          Quiz.findOne({ where: { moduleId: mod.id } }),
        ]);
        return { ...mod.toJSON(), lessons, quiz };
      }),
    );

    res.json({ ...course.toJSON(), modules: modulesWithContent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create course
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { title, description, difficulty, status } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    const course = await Course.create({
      title,
      description,
      difficulty,
      status,
      createdBy: req.user.id,
    });
    res.status(201).json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload intro video
router.post(
  "/:id/intro-video",
  protect,
  adminOnly,
  upload.single("video"),
  async (req, res) => {
    try {
      const course = await Course.findByPk(req.params.id);
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (req.user.role === "admin" && course.createdBy !== req.user.id)
        return res
          .status(403)
          .json({ error: "Not authorized to update this course" });
      if (!req.file)
        return res.status(400).json({ error: "No video file uploaded" });
      if (course.introVideoCloudinaryId) {
        await cloudinary.uploader.destroy(course.introVideoCloudinaryId, {
          resource_type: "video",
        });
      }
      await course.update({
        introVideoUrl: req.file.path,
        introVideoCloudinaryId: req.file.filename,
      });
      res.json(course);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Add this after the intro-video route, before PUT
// POST /api/courses/:id/thumbnail — upload course thumbnail
router.post(
  "/:id/thumbnail",
  protect,
  adminOnly,
  multer({
    storage: new CloudinaryStorage({
      cloudinary,
      params: {
        folder: "lms/thumbnails",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      },
    }),
  }).single("thumbnail"),
  async (req, res) => {
    try {
      const course = await Course.findByPk(req.params.id);
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (req.user.role === "admin" && course.createdBy !== req.user.id)
        return res.status(403).json({ error: "Not authorized" });
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });

      if (course.thumbnailCloudinaryId) {
        await cloudinary.uploader.destroy(course.thumbnailCloudinaryId);
      }

      await course.update({
        thumbnail: req.file.path,
        thumbnailCloudinaryId: req.file.filename,
      });
      res.json(course);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT update course
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res
        .status(403)
        .json({ error: "Not authorized to update this course" });
    await course.update(req.body);
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE course
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res
        .status(403)
        .json({ error: "Not authorized to delete this course" });
    if (course.introVideoCloudinaryId) {
      await cloudinary.uploader.destroy(course.introVideoCloudinaryId, {
        resource_type: "video",
      });
    }
    await course.destroy();
    res.json({ message: "Course deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save intro video URL (after direct Cloudinary upload)
router.post("/:id/intro-video-url", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    await course.update({
      introVideoUrl: req.body.introVideoUrl,
      introVideoCloudinaryId: req.body.introVideoCloudinaryId,
    });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save thumbnail URL (after direct Cloudinary upload)
router.post("/:id/thumbnail-url", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    await course.update({
      thumbnail: req.body.thumbnail,
      thumbnailCloudinaryId: req.body.thumbnailCloudinaryId,
    });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
