import express from "express";
import multer from "multer";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { protect, adminOnly } from "../middleware/auth.js";
import {
  createUploadUrl,
  uploadFile,
  deleteFile,
  getFileUrl,
} from "../config/storage.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

async function serializeCourse(course) {
  const data = course.toJSON ? course.toJSON() : course;
  return {
    ...data,
    thumbnail: await getFileUrl(data.thumbnailCloudinaryId, data.thumbnail),
    introVideoUrl: await getFileUrl(
      data.introVideoCloudinaryId,
      data.introVideoUrl,
    ),
  };
}

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

function publicLessonOutline(lesson) {
  const data = lesson.toJSON ? lesson.toJSON() : lesson;
  return {
    id: data.id,
    moduleId: data.moduleId,
    title: data.title,
    type: data.type,
    duration: data.duration,
    order: data.order,
    locked: true,
    content: "",
    videoUrl: "",
  };
}

function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function hasCourseAccess(req, course) {
  const authUser = getAuthUser(req);
  // 1️⃣ No auth – never grant full access (preview only for any course)
  if (!authUser) return false;

  // 2️⃣ Privileged roles – super‑admin, admin, instructor, staff can see everything
  const privilegedRoles = ["super-admin", "admin", "instructor", "staff"];
  if (privilegedRoles.includes(authUser.role)) return true;

  // 3️⃣ Regular users – require enrollment regardless of free/paid status
  const enrollment = await Enrollment.findOne({
    where: { userId: authUser.id, courseId: course.id },
  });
  return Boolean(enrollment);
}

// GET all courses
router.get("/", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let where = {};
    let isSuperAdmin = false;

    if (authHeader) {
      try {
        const decoded = jwt.verify(
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

    res.json(await Promise.all(courses.map(serializeCourse)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single course with full structure
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    const canAccessContent = await hasCourseAccess(req, course);

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
        return {
          ...mod.toJSON(),
          lessons: canAccessContent
            ? await Promise.all(lessons.map(serializeLesson))
            : lessons.map(publicLessonOutline),
          quiz: canAccessContent ? quiz : quiz ? { id: quiz.id, moduleId: quiz.moduleId, title: quiz.title } : null,
        };
      }),
    );

    res.json({
      ...(await serializeCourse(course)),
      hasAccess: canAccessContent,
      modules: modulesWithContent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create course
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { title, description, difficulty, status } = req.body;
    const pricingType = req.body.pricingType === "paid" ? "paid" : "free";
    const price = pricingType === "paid" ? Number(req.body.price || 0) : 0;

    if (!title) return res.status(400).json({ error: "Title is required" });
    if (pricingType === "paid" && price <= 0) {
      return res.status(400).json({ error: "Paid courses need a price" });
    }

    const course = await Course.create({
      title,
      description,
      difficulty,
      status,
      pricingType,
      price,
      currency: req.body.currency || "NGN",
      createdBy: req.user.id,
    });
    res.status(201).json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload intro video
router.post("/:id/intro-video-upload-url", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res
        .status(403)
        .json({ error: "Not authorized to update this course" });

    const { filename, contentType } = req.body;
    if (!filename)
      return res.status(400).json({ error: "Filename is required" });

    const upload = await createUploadUrl({
      filename,
      contentType,
      folder: "lms/intro-videos",
    });

    res.json(upload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
        await deleteFile(course.introVideoCloudinaryId, "video");
      }

      const fileData = await uploadFile(req.file, "lms/intro-videos");
      await course.update({
        introVideoUrl: fileData.url,
        introVideoCloudinaryId: fileData.id,
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
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const course = await Course.findByPk(req.params.id);
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (req.user.role === "admin" && course.createdBy !== req.user.id)
        return res.status(403).json({ error: "Not authorized" });
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });

      if (course.thumbnailCloudinaryId) {
        await deleteFile(course.thumbnailCloudinaryId, "image");
      }

      const fileData = await uploadFile(req.file, "lms/thumbnails");
      await course.update({
        thumbnail: fileData.url,
        thumbnailCloudinaryId: fileData.id,
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

    const nextPricingType =
      req.body.pricingType === undefined
        ? course.pricingType
        : req.body.pricingType === "paid"
          ? "paid"
          : "free";
    const nextPrice =
      nextPricingType === "paid"
        ? Number(req.body.price ?? course.price ?? 0)
        : 0;

    if (nextPricingType === "paid" && nextPrice <= 0) {
      return res.status(400).json({ error: "Paid courses need a price" });
    }

    await course.update({
      ...req.body,
      pricingType: nextPricingType,
      price: nextPrice,
      currency: req.body.currency || course.currency || "NGN",
    });
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
      await deleteFile(course.introVideoCloudinaryId, "video");
    }
    if (course.thumbnailCloudinaryId) {
      await deleteFile(course.thumbnailCloudinaryId, "image");
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
