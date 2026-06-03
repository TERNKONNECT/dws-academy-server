import express from "express";
import { Op } from "sequelize";
import Enrollment from "../models/Enrollment.js";
import LessonProgress from "../models/LessonProgress.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import { protect, adminOnly } from "../middleware/auth.js";
import sequelize from "../config/db.js";

const router = express.Router();

// ── User endpoints ────────────────────────────────────────────────────────────

// POST /api/enrollments/:courseId — enroll logged-in user in a course
router.post("/:courseId", protect, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (course.pricingType === "paid" && Number(course.price) > 0) {
      return res.status(402).json({
        error: "Payment is required before enrolling in this course",
      });
    }

    const [enrollment, created] = await Enrollment.findOrCreate({
      where: { userId: req.user.id, courseId: req.params.courseId },
      defaults: { userId: req.user.id, courseId: req.params.courseId },
    });

    if (!created) return res.status(400).json({ error: "Already enrolled" });
    res.status(201).json(enrollment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments/my — get all courses the logged-in user is enrolled in
router.get("/my", protect, async (req, res) => {
  try {
    const enrollments = await Enrollment.findAll({
      where: { userId: req.user.id },
      include: [{ model: Course }],
      order: [["createdAt", "DESC"]],
    });

    const result = await Promise.all(
      enrollments.map(async (e) => {
        const totalLessons = await Lesson.count({
          include: [
            { model: Module, where: { courseId: e.courseId }, required: true },
          ],
        });
        const completedLessonRows = await LessonProgress.findAll({
          where: { enrollmentId: e.id },
        });
        const completedLessons = completedLessonRows.length;
        const progressPct =
          totalLessons > 0
            ? Math.round((completedLessons / totalLessons) * 100)
            : 0;

        return {
          enrollmentId: e.id,
          enrolledAt: e.createdAt,
          isCompleted: e.isCompleted,
          completedAt: e.completedAt,
          course: e.Course,
          totalLessons,
          completedLessons,
          completedLessonIds: completedLessonRows.map((progress) => progress.lessonId),
          progressPct,
        };
      }),
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/enrollments/:courseId/lessons/:lessonId/complete — mark a lesson complete
router.post(
  "/:courseId/lessons/:lessonId/complete",
  protect,
  async (req, res) => {
    try {
      const enrollment = await Enrollment.findOne({
        where: { userId: req.user.id, courseId: req.params.courseId },
      });
      if (!enrollment)
        return res.status(404).json({ error: "Not enrolled in this course" });

      const lesson = await Lesson.findByPk(req.params.lessonId);
      if (!lesson) return res.status(404).json({ error: "Lesson not found" });

      const [progress, created] = await LessonProgress.findOrCreate({
        where: { enrollmentId: enrollment.id, lessonId: req.params.lessonId },
        defaults: {
          enrollmentId: enrollment.id,
          lessonId: req.params.lessonId,
        },
      });

      // Check if all lessons in the course are now complete
      const totalLessons = await Lesson.count({
        include: [
          {
            model: Module,
            where: { courseId: req.params.courseId },
            required: true,
          },
        ],
      });
      const completedLessons = await LessonProgress.count({
        where: { enrollmentId: enrollment.id },
      });

      if (totalLessons > 0 && completedLessons >= totalLessons) {
        await enrollment.update({ isCompleted: true, completedAt: new Date() });
      }

      res.json({
        lessonId: req.params.lessonId,
        alreadyCompleted: !created,
        totalLessons,
        completedLessons,
        progressPct: Math.round((completedLessons / totalLessons) * 100),
        courseCompleted: enrollment.isCompleted,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/enrollments/:courseId/progress — get logged-in user's progress on a course
router.get("/:courseId/progress", protect, async (req, res) => {
  try {
    const enrollment = await Enrollment.findOne({
      where: { userId: req.user.id, courseId: req.params.courseId },
    });
    if (!enrollment) return res.status(404).json({ error: "Not enrolled" });

    const completedLessons = await LessonProgress.findAll({
      where: { enrollmentId: enrollment.id },
    });

    const totalLessons = await Lesson.count({
      include: [
        {
          model: Module,
          where: { courseId: req.params.courseId },
          required: true,
        },
      ],
    });

    res.json({
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.createdAt,
      isCompleted: enrollment.isCompleted,
      completedAt: enrollment.completedAt,
      totalLessons,
      completedLessons: completedLessons.length,
      progressPct:
        totalLessons > 0
          ? Math.round((completedLessons.length / totalLessons) * 100)
          : 0,
      completedLessonIds: completedLessons.map((p) => p.lessonId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

// GET /api/enrollments/admin/all — all enrollments across all courses
router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const courseWhere = req.user.role === "admin" ? { createdBy: req.user.id } : {};
    const enrollments = await Enrollment.findAll({
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        {
          model: Course,
          attributes: ["id", "title", "difficulty", "status", "createdBy"],
          where: courseWhere,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const result = await Promise.all(
      enrollments.map(async (e) => {
        const totalLessons = await Lesson.count({
          include: [
            { model: Module, where: { courseId: e.courseId }, required: true },
          ],
        });
        const completedLessons = await LessonProgress.count({
          where: { enrollmentId: e.id },
        });
        return {
          enrollmentId: e.id,
          enrolledAt: e.createdAt,
          isCompleted: e.isCompleted,
          completedAt: e.completedAt,
          user: e.User,
          course: e.Course,
          totalLessons,
          completedLessons,
          progressPct:
            totalLessons > 0
              ? Math.round((completedLessons / totalLessons) * 100)
              : 0,
        };
      }),
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments/admin/courses/:courseId — all users enrolled in a specific course
router.get("/admin/courses/:courseId", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });

    const enrollments = await Enrollment.findAll({
      where: { courseId: req.params.courseId },
      include: [
        { model: User, attributes: ["id", "name", "email", "createdAt"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const totalLessons = await Lesson.count({
      include: [
        {
          model: Module,
          where: { courseId: req.params.courseId },
          required: true,
        },
      ],
    });

    const result = await Promise.all(
      enrollments.map(async (e) => {
        const completedLessons = await LessonProgress.count({
          where: { enrollmentId: e.id },
        });
        return {
          enrollmentId: e.id,
          enrolledAt: e.createdAt,
          isCompleted: e.isCompleted,
          completedAt: e.completedAt,
          user: e.User,
          totalLessons,
          completedLessons,
          progressPct:
            totalLessons > 0
              ? Math.round((completedLessons / totalLessons) * 100)
              : 0,
        };
      }),
    );

    res.json({
      course: { id: course.id, title: course.title },
      totalEnrolled: result.length,
      totalCompleted: result.filter((r) => r.isCompleted).length,
      students: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments/admin/users/:userId — all courses a specific user is enrolled in
router.get("/admin/users/:userId", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      attributes: ["id", "name", "email", "createdAt"],
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const enrollments = await Enrollment.findAll({
      where: { userId: req.params.userId },
      include: [
        { model: Course, attributes: ["id", "title", "difficulty", "status"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const result = await Promise.all(
      enrollments.map(async (e) => {
        const totalLessons = await Lesson.count({
          include: [
            { model: Module, where: { courseId: e.courseId }, required: true },
          ],
        });
        const completedLessons = await LessonProgress.count({
          where: { enrollmentId: e.id },
        });
        return {
          enrollmentId: e.id,
          enrolledAt: e.createdAt,
          isCompleted: e.isCompleted,
          completedAt: e.completedAt,
          course: e.Course,
          totalLessons,
          completedLessons,
          progressPct:
            totalLessons > 0
              ? Math.round((completedLessons / totalLessons) * 100)
              : 0,
        };
      }),
    );

    res.json({ user, enrollments: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/enrollments/admin/stats — overall platform statistics
router.get("/admin/stats", protect, adminOnly, async (req, res) => {
  try {
    const courseWhere = req.user.role === "admin" ? { createdBy: req.user.id } : {};
    const courses = await Course.findAll({
      where: courseWhere,
      attributes: ["id"],
    });
    const courseIds = courses.map((course) => course.id);
    const enrollmentWhere =
      req.user.role === "admin" ? { courseId: courseIds } : {};
    const [totalUsers, totalCourses, totalEnrollments, totalCompleted] =
      await Promise.all([
        req.user.role === "admin" && courseIds.length === 0
          ? 0
          : User.count({
              where: { role: "user" },
              include:
                req.user.role === "admin"
                  ? [
                      {
                        model: Enrollment,
                        where: { courseId: courseIds },
                        required: true,
                      },
                    ]
                  : [],
              distinct: true,
            }),
        Course.count({ where: courseWhere }),
        courseIds.length === 0 && req.user.role === "admin"
          ? 0
          : Enrollment.count({ where: enrollmentWhere }),
        courseIds.length === 0 && req.user.role === "admin"
          ? 0
          : Enrollment.count({
              where: { ...enrollmentWhere, isCompleted: true },
            }),
      ]);

    // Top 5 most enrolled courses
    const topCourses = await Enrollment.findAll({
      attributes: [
        "courseId",
        [
          sequelize.fn("COUNT", sequelize.col("Enrollment.id")),
          "enrollmentCount",
        ],
      ],
      include: [{ model: Course, attributes: ["id", "title"], where: courseWhere }],
      group: ["courseId", "Course.id", "Course.title"],
      order: [[sequelize.fn("COUNT", sequelize.col("Enrollment.id")), "DESC"]],
      limit: 5,
    });

    res.json({
      totalUsers,
      totalCourses,
      totalEnrollments,
      totalCompleted,
      completionRate:
        totalEnrollments > 0
          ? Math.round((totalCompleted / totalEnrollments) * 100)
          : 0,
      topCourses: topCourses.map((e) => ({
        courseId: e.courseId,
        title: e.Course?.title,
        enrollmentCount: parseInt(e.dataValues.enrollmentCount),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
