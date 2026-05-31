import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import Enrollment from "../models/Enrollment.js";
import LessonProgress from "../models/LessonProgress.js";
import {
  adminInviteEmailTemplate,
  appUrl,
  sendEmail,
} from "../config/email.js";
import { protect, superAdminOnly } from "../middleware/auth.js";
import { Op } from "sequelize";

const router = express.Router();

const hashValue = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const normalizeEmail = (email) => email.toLowerCase().trim();
const tokenExpiry = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

function getLastSixMonths() {
  const formatter = new Intl.DateTimeFormat("en", { month: "short" });
  const current = new Date();

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - 5 + index, 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: formatter.format(date),
      start: date,
    };
  });
}

function monthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

async function getGrowthData(Model) {
  const months = getLastSixMonths();
  const countsByMonth = Object.fromEntries(months.map((month) => [month.key, 0]));

  const records = await Model.findAll({
    attributes: ["createdAt"],
    where: { createdAt: { [Op.gte]: months[0].start } },
  });

  records.forEach((record) => {
    const key = monthKey(record.createdAt);
    if (key in countsByMonth) countsByMonth[key] += 1;
  });

  return {
    labels: months.map((month) => month.label),
    data: months.map((month) => countsByMonth[month.key]),
  };
}

// GET /api/superadmin/instructors — all admins with their course counts
router.get("/instructors", protect, superAdminOnly, async (req, res) => {
  try {
    const instructors = await User.findAll({
      where: { role: "admin" },
      attributes: [
        "id",
        "name",
        "email",
        "createdAt",
        "adminInviteExpires",
        "passwordSetupRequired",
      ],
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
          inviteStatus: instructor.passwordSetupRequired ? "pending" : "accepted",
          inviteExpiresAt: instructor.adminInviteExpires,
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
// POST /api/superadmin/instructors/invite - invite a new admin by email
router.post("/instructors/invite", protect, superAdminOnly, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email)
      return res.status(400).json({ error: "Name and email are required" });

    const normalizedEmail = normalizeEmail(email);
    const existing = await User.findOne({ where: { email: normalizedEmail } });

    if (existing && existing.role !== "admin") {
      return res.status(400).json({
        error: "This email already belongs to another account.",
      });
    }

    if (existing && !existing.passwordSetupRequired) {
      return res.status(400).json({
        error: "This admin has already accepted an invitation.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const temporaryPassword = crypto.randomBytes(32).toString("hex");

    const admin =
      existing ||
      (await User.create({
        name: String(name).trim(),
        email: normalizedEmail,
        password: temporaryPassword,
        role: "admin",
        emailVerified: true,
        passwordSetupRequired: true,
      }));

    admin.name = String(name).trim();
    admin.adminInviteToken = hashValue(token);
    admin.adminInviteExpires = tokenExpiry(7);
    admin.passwordSetupRequired = true;
    await admin.save();

    const inviter = await User.findByPk(req.user.id, { attributes: ["name"] });
    const link = appUrl(
      `/admin-invite?token=${token}&email=${encodeURIComponent(admin.email)}`,
    );

    await sendEmail({
      to: admin.email,
      subject: "You have been invited to become a DWS Academy admin",
      html: adminInviteEmailTemplate({
        name: admin.name,
        inviterName: inviter?.name || "A super admin",
        link,
      }),
    });

    res.status(existing ? 200 : 201).json({
      message: existing
        ? "Admin invitation resent successfully."
        : "Admin invitation sent successfully.",
      instructor: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        joinedAt: admin.createdAt,
        inviteStatus: "pending",
        inviteExpiresAt: admin.adminInviteExpires,
        totalCourses: 0,
        totalEnrollments: 0,
        totalCompleted: 0,
        completionRate: 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      totalLessons,
      totalQuizzes,
    ] = await Promise.all([
      User.count({ where: { role: "user" } }),
      User.count({ where: { role: "admin" } }),
      Course.count(),
      Enrollment.count(),
      Enrollment.count({ where: { isCompleted: true } }),
      Lesson.count(),
      Quiz.count(),
    ]);

    res.json({
      totalUsers,
      totalAdmins,
      totalCourses,
      totalEnrollments,
      totalLessons,
      totalQuizzes,
      activeUsers: totalUsers,
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

// GET /api/superadmin/user-growth — user signups for the last six months
router.get("/user-growth", protect, superAdminOnly, async (req, res) => {
  try {
    res.json(await getGrowthData(User));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/superadmin/enrollment-growth — enrollments for the last six months
router.get("/enrollment-growth", protect, superAdminOnly, async (req, res) => {
  try {
    res.json(await getGrowthData(Enrollment));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
