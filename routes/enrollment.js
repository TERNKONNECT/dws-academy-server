import express from "express";
import { Op } from "sequelize";
import Enrollment from "../models/Enrollment.js";
import LessonProgress from "../models/LessonProgress.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import { protect, adminOnly, strictAdminOnly } from "../middleware/auth.js";
import sequelize from "../config/db.js";
import {
  countLessonsByCourse,
  countProgressByEnrollment,
  evaluateCourseCompletion,
  syncCourseCompletion,
} from "../services/completion.js";

const router = express.Router();

// Staff who may look at a course they aren't enrolled in.
const PREVIEW_ROLES = new Set(["admin", "super-admin", "operator"]);

/** Courses this caller is allowed to see enrolment data for. `null` means all. */
async function scopedCourseIds(req) {
  if (req.user.role === "super-admin") return null;
  const courses = await Course.findAll({
    where: { createdBy: req.user.id },
    attributes: ["id"],
  });
  return courses.map((c) => c.id);
}

// ── User endpoints ────────────────────────────────────────────────────────────

// POST /api/enrollments/:courseId — enroll logged-in user in a course
router.post("/:courseId", protect, async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (course.status !== "published") {
      return res.status(400).json({ error: "Course is not available" });
    }
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
    next(err);
  }
});

// GET /api/enrollments/my — get all courses the logged-in user is enrolled in
router.get("/my", protect, async (req, res, next) => {
  try {
    const enrollments = await Enrollment.findAll({
      where: { userId: req.user.id },
      include: [{ model: Course }],
      order: [["createdAt", "DESC"]],
    });

    // Two grouped queries instead of two per enrolment.
    const [lessonCounts, progressCounts, progressRows] = await Promise.all([
      countLessonsByCourse(enrollments.map((e) => e.courseId)),
      countProgressByEnrollment(enrollments.map((e) => e.id)),
      LessonProgress.findAll({
        where: { enrollmentId: enrollments.map((e) => e.id) },
        attributes: ["enrollmentId", "lessonId"],
        raw: true,
      }),
    ]);

    const lessonIdsByEnrollment = new Map();
    for (const row of progressRows) {
      const list = lessonIdsByEnrollment.get(row.enrollmentId) ?? [];
      list.push(row.lessonId);
      lessonIdsByEnrollment.set(row.enrollmentId, list);
    }

    res.json(
      enrollments.map((e) => {
        const totalLessons = lessonCounts.get(e.courseId) ?? 0;
        const completedLessons = progressCounts.get(e.id) ?? 0;
        return {
          enrollmentId: e.id,
          enrolledAt: e.createdAt,
          isCompleted: e.isCompleted,
          completedAt: e.completedAt,
          course: e.Course,
          totalLessons,
          completedLessons,
          completedLessonIds: lessonIdsByEnrollment.get(e.id) ?? [],
          progressPct:
            totalLessons > 0
              ? Math.round((completedLessons / totalLessons) * 100)
              : 0,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/:courseId/lessons/:lessonId/complete — mark a lesson complete
router.post(
  "/:courseId/lessons/:lessonId/complete",
  protect,
  async (req, res, next) => {
    try {
      const enrollment = await Enrollment.findOne({
        where: { userId: req.user.id, courseId: req.params.courseId },
      });

      // Staff can walk a course without an enrolment record; nothing is persisted.
      if (!enrollment && PREVIEW_ROLES.has(req.user.role)) {
        return res.json({
          lessonId: req.params.lessonId,
          preview: true,
          alreadyCompleted: false,
          totalLessons: 0,
          completedLessons: 0,
          progressPct: 0,
          courseCompleted: false,
        });
      }

      if (!enrollment) {
        return res.status(404).json({ error: "Not enrolled in this course" });
      }

      // The lesson has to belong to *this* course. Without this check a student
      // could post lesson ids harvested from other courses until the completed
      // count reached this course's total, and collect a certificate for it.
      const lesson = await Lesson.findOne({
        where: { id: req.params.lessonId },
        include: [
          {
            model: Module,
            attributes: [],
            where: { courseId: req.params.courseId },
            required: true,
          },
        ],
      });
      if (!lesson) {
        return res
          .status(404)
          .json({ error: "Lesson not found in this course" });
      }

      const [, created] = await LessonProgress.findOrCreate({
        where: { enrollmentId: enrollment.id, lessonId: lesson.id },
        defaults: { enrollmentId: enrollment.id, lessonId: lesson.id },
      });

      const completion = await syncCourseCompletion(enrollment);

      res.json({
        lessonId: lesson.id,
        alreadyCompleted: !created,
        totalLessons: completion.totalLessons,
        completedLessons: completion.completedLessons,
        progressPct: completion.progressPct,
        courseCompleted: completion.isCompleted,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/enrollments/:courseId/progress — get logged-in user's progress on a course
router.get("/:courseId/progress", protect, async (req, res, next) => {
  try {
    const enrollment = await Enrollment.findOne({
      where: { userId: req.user.id, courseId: req.params.courseId },
    });

    if (!enrollment) {
      if (PREVIEW_ROLES.has(req.user.role)) {
        return res.json({
          preview: true,
          enrollmentId: null,
          enrolledAt: null,
          isCompleted: false,
          completedAt: null,
          totalLessons: 0,
          completedLessons: 0,
          progressPct: 0,
          completedLessonIds: [],
        });
      }
      return res.status(404).json({ error: "Not enrolled" });
    }

    const [completion, completedLessons] = await Promise.all([
      evaluateCourseCompletion(enrollment),
      LessonProgress.findAll({
        where: { enrollmentId: enrollment.id },
        attributes: ["lessonId"],
        raw: true,
      }),
    ]);

    res.json({
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.createdAt,
      isCompleted: enrollment.isCompleted,
      completedAt: enrollment.completedAt,
      totalLessons: completion.totalLessons,
      completedLessons: completion.completedLessons,
      totalQuizzes: completion.totalQuizzes,
      passedQuizzes: completion.passedQuizzes,
      progressPct: completion.progressPct,
      completedLessonIds: completedLessons.map((p) => p.lessonId),
    });
  } catch (err) {
    next(err);
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

// POST /api/enrollments/admin/enroll — admin/instructor enrolls a registered user by email
router.post("/admin/enroll", protect, strictAdminOnly, async (req, res, next) => {
  try {
    const { email, courseId } = req.body;

    if (!email || !courseId) {
      return res.status(400).json({ error: "Email and courseId are required" });
    }

    const course = await Course.findByPk(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // An instructor can only grant access to their own courses.
    if (req.user.role !== "super-admin" && course.createdBy !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Not authorized to enrol students in this course" });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      return res
        .status(404)
        .json({ error: "User does not exist on the platform" });
    }

    const [enrollment, created] = await Enrollment.findOrCreate({
      where: { userId: user.id, courseId },
      defaults: { userId: user.id, courseId, enrolledBy: req.user.id },
    });

    if (!created) {
      return res
        .status(400)
        .json({ error: "This user is already enrolled in this course" });
    }

    res.status(201).json({
      message: `${user.name} has been enrolled successfully`,
      enrollment: {
        enrollmentId: enrollment.id,
        enrolledAt: enrollment.createdAt,
        isCompleted: false,
        completedAt: null,
        user: { id: user.id, name: user.name, email: user.email },
        course: { id: course.id, title: course.title },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/enrollments/admin/all — enrollments, scoped to the caller's own courses
router.get("/admin/all", protect, adminOnly, async (req, res, next) => {
  try {
    const courseIds = await scopedCourseIds(req);
    const where = courseIds === null ? {} : { courseId: courseIds };
    if (courseIds !== null && courseIds.length === 0) return res.json([]);

    const enrollments = await Enrollment.findAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Course, attributes: ["id", "title", "difficulty", "status"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const [lessonCounts, progressCounts] = await Promise.all([
      countLessonsByCourse([...new Set(enrollments.map((e) => e.courseId))]),
      countProgressByEnrollment(enrollments.map((e) => e.id)),
    ]);

    res.json(
      enrollments.map((e) => {
        const totalLessons = lessonCounts.get(e.courseId) ?? 0;
        const completedLessons = progressCounts.get(e.id) ?? 0;
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
  } catch (err) {
    next(err);
  }
});

// GET /api/enrollments/admin/courses/:courseId — all users enrolled in a specific course
router.get("/admin/courses/:courseId", protect, adminOnly, async (req, res, next) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    if (req.user.role !== "super-admin" && course.createdBy !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Not authorized to view students for this course" });
    }

    const where = { courseId: req.params.courseId };
    if (req.query.source === "admin") where.enrolledBy = { [Op.ne]: null };
    else if (req.query.source === "self") where.enrolledBy = null;

    const enrollments = await Enrollment.findAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email", "createdAt"] },
        { model: User, as: "EnrolledByAdmin", attributes: ["id", "name"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const lessonCounts = await countLessonsByCourse([req.params.courseId]);
    const totalLessons = lessonCounts.get(req.params.courseId) ?? 0;
    const progressCounts = await countProgressByEnrollment(
      enrollments.map((e) => e.id),
    );

    const result = enrollments.map((e) => {
      const completedLessons = progressCounts.get(e.id) ?? 0;
      return {
        enrollmentId: e.id,
        enrolledAt: e.createdAt,
        isCompleted: e.isCompleted,
        completedAt: e.completedAt,
        user: e.User,
        enrolledByAdmin: e.EnrolledByAdmin
          ? { id: e.EnrolledByAdmin.id, name: e.EnrolledByAdmin.name }
          : null,
        totalLessons,
        completedLessons,
        progressPct:
          totalLessons > 0
            ? Math.round((completedLessons / totalLessons) * 100)
            : 0,
      };
    });

    res.json({
      course: {
        id: course.id,
        title: course.title,
        pricingType: course.pricingType,
      },
      totalEnrolled: result.length,
      totalCompleted: result.filter((r) => r.isCompleted).length,
      students: result,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/enrollments/admin/users/:userId — a user's enrolments in the caller's courses
router.get("/admin/users/:userId", protect, adminOnly, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      attributes: ["id", "name", "email", "createdAt"],
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const courseIds = await scopedCourseIds(req);
    const where = { userId: req.params.userId };
    if (courseIds !== null) {
      if (courseIds.length === 0) return res.json({ user, enrollments: [] });
      where.courseId = courseIds;
    }

    const enrollments = await Enrollment.findAll({
      where,
      include: [
        { model: Course, attributes: ["id", "title", "difficulty", "status"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const [lessonCounts, progressCounts] = await Promise.all([
      countLessonsByCourse([...new Set(enrollments.map((e) => e.courseId))]),
      countProgressByEnrollment(enrollments.map((e) => e.id)),
    ]);

    res.json({
      user,
      enrollments: enrollments.map((e) => {
        const totalLessons = lessonCounts.get(e.courseId) ?? 0;
        const completedLessons = progressCounts.get(e.id) ?? 0;
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
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/enrollments/admin/stats — platform statistics, scoped to the caller
router.get("/admin/stats", protect, adminOnly, async (req, res, next) => {
  try {
    const courseIds = await scopedCourseIds(req);
    const enrollmentWhere = courseIds === null ? {} : { courseId: courseIds };

    const [totalUsers, totalCourses, totalEnrollments, totalCompleted] =
      await Promise.all([
        courseIds === null
          ? User.count({ where: { role: "user" } })
          : Enrollment.count({
              distinct: true,
              col: "userId",
              where: enrollmentWhere,
            }),
        courseIds === null ? Course.count() : courseIds.length,
        Enrollment.count({ where: enrollmentWhere }),
        Enrollment.count({ where: { ...enrollmentWhere, isCompleted: true } }),
      ]);

    const topCourses = await Enrollment.findAll({
      where: enrollmentWhere,
      attributes: [
        "courseId",
        [
          sequelize.fn("COUNT", sequelize.col("Enrollment.id")),
          "enrollmentCount",
        ],
      ],
      include: [{ model: Course, attributes: ["id", "title"] }],
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
        enrollmentCount: parseInt(e.dataValues.enrollmentCount, 10),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
