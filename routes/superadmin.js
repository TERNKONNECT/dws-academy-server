import express from "express";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Enrollment from "../models/Enrollment.js";
import LessonProgress from "../models/LessonProgress.js";
import { protect, superAdminOnly } from "../middleware/auth.js";

const router = express.Router();

// GET /api/superadmin/instructors — all admins with their course counts
router.get("/instructors", protect, superAdminOnly, async (req, res) => {
  try {
    const instructors = await User.findAll({
      where: { role: "admin" },
      attributes: ["id", "name", "email", "createdAt"],
      order: [["createdAt", "DESC"]],
    });

    const result = await Promise.all(
      instructors.map(async (instructor) => {
        const courses = await Course.findAll({
          where: { createdBy: instructor.id },
          attributes: ["id"],
        });

        const courseIds = courses.map((c) => c.id);

        const totalEnrollments =
          courseIds.length > 0
            ? await Enrollment.count({ where: { courseId: courseIds } })
            : 0;

        const totalCompleted =
          courseIds.length > 0
            ? await Enrollment.count({
                where: { courseId: courseIds, isCompleted: true },
              })
            : 0;

        return {
          id: instructor.id,
          name: instructor.name,
          email: instructor.email,
          joinedAt: instructor.createdAt,
          totalCourses: courses.length,
          totalEnrollments,
          totalCompleted,
          completionRate:
            totalEnrollments > 0
              ? Math.round((totalCompleted / totalEnrollments) * 100)
              : 0,
        };
      }),
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/superadmin/instructors/:id — one instructor's full details + courses
router.get("/instructors/:id", protect, superAdminOnly, async (req, res) => {
  try {
    const instructor = await User.findOne({
      where: { id: req.params.id, role: "admin" },
      attributes: ["id", "name", "email", "createdAt"],
    });
    if (!instructor)
      return res.status(404).json({ error: "Instructor not found" });

    const courses = await Course.findAll({
      where: { createdBy: req.params.id },
      order: [["createdAt", "DESC"]],
    });

    const coursesWithStats = await Promise.all(
      courses.map(async (course) => {
        const totalLessons = await Lesson.count({
          include: [
            { model: Module, where: { courseId: course.id }, required: true },
          ],
        });

        const enrollments = await Enrollment.findAll({
          where: { courseId: course.id },
          include: [{ model: User, attributes: ["id", "name", "email"] }],
        });

        const studentsWithProgress = await Promise.all(
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

        return {
          ...course.toJSON(),
          totalLessons,
          totalEnrolled: enrollments.length,
          totalCompleted: enrollments.filter((e) => e.isCompleted).length,
          completionRate:
            enrollments.length > 0
              ? Math.round(
                  (enrollments.filter((e) => e.isCompleted).length /
                    enrollments.length) *
                    100,
                )
              : 0,
          students: studentsWithProgress,
        };
      }),
    );

    res.json({
      instructor: {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        joinedAt: instructor.createdAt,
      },
      totalCourses: courses.length,
      courses: coursesWithStats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/superadmin/stats — platform-wide stats for super admin dashboard
router.get("/stats", protect, superAdminOnly, async (req, res) => {
  try {
    const [
      totalUsers,
      totalAdmins,
      totalCourses,
      totalEnrollments,
      totalCompleted,
    ] = await Promise.all([
      User.count({ where: { role: "user" } }),
      User.count({ where: { role: "admin" } }),
      Course.count(),
      Enrollment.count(),
      Enrollment.count({ where: { isCompleted: true } }),
    ]);

    res.json({
      totalUsers,
      totalAdmins,
      totalCourses,
      totalEnrollments,
      totalCompleted,
      completionRate:
        totalEnrollments > 0
          ? Math.round((totalCompleted / totalEnrollments) * 100)
          : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
