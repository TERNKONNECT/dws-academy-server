import express from "express";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import User from "../models/User.js";
import { protect, adminOnly, optionalAuth } from "../middleware/auth.js";
import {
  canAccessCourseContent,
  courseOwnershipGate,
} from "../middleware/courseAccess.js";
import { imageUpload, videoUpload } from "../middleware/uploads.js";
import { publicQuizOutline } from "../services/quizSerializer.js";
import {
  createUploadUrl,
  uploadFile,
  deleteFile,
  getFileUrl,
} from "../config/storage.js";

const router = express.Router();
const requireCourseOwnership = courseOwnershipGate("id");

// Roles allowed to see unpublished drafts in listings.
const DRAFT_VIEWER_ROLES = new Set(["admin", "super-admin", "operator"]);

// Fields a course write is allowed to touch. Anything else in the body — `id`,
// `createdBy`, timestamps — is ignored rather than spread into the model.
const WRITABLE_COURSE_FIELDS = [
  "title",
  "description",
  "difficulty",
  "status",
  "whatYouLearn",
  "introVideoUrl",
  "introVideoCloudinaryId",
  "thumbnail",
  "thumbnailCloudinaryId",
];

function pickCourseFields(body) {
  const out = {};
  for (const field of WRITABLE_COURSE_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  return out;
}

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

// GET all courses
router.get("/", optionalAuth, async (req, res, next) => {
  try {
    // Default to published for everyone. Only roles that are explicitly allowed to
    // see drafts get a wider filter — an unrecognised future role fails closed.
    let where = { status: "published" };
    const isSuperAdmin = req.user?.role === "super-admin";

    if (req.user?.role === "admin") {
      where = { createdBy: req.user.id };
    } else if (isSuperAdmin || req.user?.role === "operator") {
      where = {};
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

    // private: different users see different sets (enrolled/published filter)
    res.set("Cache-Control", "private, max-age=60");
    res.json(await Promise.all(courses.map(serializeCourse)));
  } catch (err) {
    next(err);
  }
});

// GET single course with full structure
router.get("/:id", optionalAuth, async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // Drafts are only visible to staff and the instructor who owns them.
    const canSeeDraft =
      DRAFT_VIEWER_ROLES.has(req.user?.role) || course.createdBy === req.user?.id;
    if (course.status !== "published" && !canSeeDraft) {
      return res.status(404).json({ error: "Course not found" });
    }

    const canAccessContent = await canAccessCourseContent(req, course);

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
          // Never ship the answer key. Even enrolled students get the questions
          // without `correctIndex` — grading happens server-side.
          quiz: publicQuizOutline(quiz, { includeQuestions: canAccessContent }),
        };
      }),
    );

    res.json({
      ...(await serializeCourse(course)),
      hasAccess: canAccessContent,
      modules: modulesWithContent,
    });
  } catch (err) {
    next(err);
  }
});

// POST create course
router.post("/", protect, adminOnly, async (req, res, next) => {
  try {
    const { title, description, difficulty, status } = req.body;
    const pricingType = req.body.pricingType === "paid" ? "paid" : "free";
    const price =
      pricingType === "paid" ? Math.round(Number(req.body.price || 0)) : 0;

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
    next(err);
  }
});

// POST upload intro video
router.post(
  "/:id/intro-video-upload-url",
  protect,
  requireCourseOwnership,
  async (req, res, next) => {
    try {
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
      next(err);
    }
  },
);

router.post(
  "/:id/intro-video",
  protect,
  requireCourseOwnership,
  videoUpload.single("video"),
  async (req, res, next) => {
    try {
      const course = req.course;
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
      next(err);
    }
  },
);

// POST /api/courses/:id/thumbnail — upload course thumbnail
router.post(
  "/:id/thumbnail",
  protect,
  requireCourseOwnership,
  imageUpload.single("thumbnail"),
  async (req, res, next) => {
    try {
      const course = req.course;
      if (!req.file) return res.status(400).json({ error: "No image uploaded" });

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
      next(err);
    }
  },
);

// PUT update course
router.put("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const course = req.course;

    const nextPricingType =
      req.body.pricingType === undefined
        ? course.pricingType
        : req.body.pricingType === "paid"
          ? "paid"
          : "free";
    const nextPrice =
      nextPricingType === "paid"
        ? Math.round(Number(req.body.price ?? course.price ?? 0))
        : 0;

    if (nextPricingType === "paid" && nextPrice <= 0) {
      return res.status(400).json({ error: "Paid courses need a price" });
    }

    await course.update({
      ...pickCourseFields(req.body),
      pricingType: nextPricingType,
      price: nextPrice,
      currency: req.body.currency || course.currency || "NGN",
    });
    res.json(course);
  } catch (err) {
    next(err);
  }
});

// DELETE course
router.delete("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const course = req.course;
    if (course.introVideoCloudinaryId) {
      await deleteFile(course.introVideoCloudinaryId, "video");
    }
    if (course.thumbnailCloudinaryId) {
      await deleteFile(course.thumbnailCloudinaryId, "image");
    }
    await course.destroy();
    res.json({ message: "Course deleted" });
  } catch (err) {
    next(err);
  }
});

// POST save intro video URL (after direct upload)
router.post(
  "/:id/intro-video-url",
  protect,
  requireCourseOwnership,
  async (req, res, next) => {
    try {
      await req.course.update({
        introVideoUrl: req.body.introVideoUrl,
        introVideoCloudinaryId: req.body.introVideoCloudinaryId,
      });
      res.json(req.course);
    } catch (err) {
      next(err);
    }
  },
);

// POST save thumbnail URL (after direct upload)
router.post(
  "/:id/thumbnail-url",
  protect,
  requireCourseOwnership,
  async (req, res, next) => {
    try {
      await req.course.update({
        thumbnail: req.body.thumbnail,
        thumbnailCloudinaryId: req.body.thumbnailCloudinaryId,
      });
      res.json(req.course);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
