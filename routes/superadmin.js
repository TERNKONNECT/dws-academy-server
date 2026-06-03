import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import Enrollment from "../models/Enrollment.js";
import LessonProgress from "../models/LessonProgress.js";
import Payment from "../models/Payment.js";
import sequelize from "../config/db.js";
import {
  adminInviteEmailTemplate,
  appUrl,
  sendEmail,
} from "../config/email.js";
import { protect, adminOnly, superAdminOnly } from "../middleware/auth.js";
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

async function getScopedCourseIds(user) {
  if (user.role === "super-admin") return null;
  const courses = await Course.findAll({
    where: { createdBy: user.id },
    attributes: ["id"],
  });
  return courses.map((course) => course.id);
}

function scopedCourseWhere(user) {
  return user.role === "super-admin" ? {} : { createdBy: user.id };
}

async function getScopedGrowthData(Model, user) {
  if (user.role === "super-admin") return getGrowthData(Model);
  const courseIds = await getScopedCourseIds(user);
  if (courseIds.length === 0) {
    const months = getLastSixMonths();
    return { labels: months.map((m) => m.label), data: months.map(() => 0) };
  }

  const months = getLastSixMonths();
  const countsByMonth = Object.fromEntries(months.map((month) => [month.key, 0]));
  const records = await Model.findAll({
    attributes: ["createdAt"],
    where: {
      courseId: courseIds,
      createdAt: { [Op.gte]: months[0].start },
    },
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

function serializeAdminUser(user, enrolledCourses = []) {
  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    isBlocked: Boolean(user.isBlocked),
    enrolledCourses,
    quizScores: [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
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

// GET /api/superadmin/users - learner list scoped to the current admin role
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const userWhere = { role: "user" };
    if (search) {
      userWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (req.user.role === "super-admin") {
      const users = await User.findAll({
        where: userWhere,
        order: [["createdAt", "DESC"]],
      });
      const result = await Promise.all(
        users.map(async (user) => {
          const enrollments = await Enrollment.findAll({
            where: { userId: user.id },
            attributes: ["courseId"],
          });
          return serializeAdminUser(
            user,
            enrollments.map((e) => e.courseId),
          );
        }),
      );
      return res.json(result);
    }

    const courseIds = await getScopedCourseIds(req.user);
    if (courseIds.length === 0) return res.json([]);

    const enrollments = await Enrollment.findAll({
      where: { courseId: courseIds },
      include: [{ model: User, where: userWhere }],
      order: [["createdAt", "DESC"]],
    });

    const usersById = new Map();
    enrollments.forEach((enrollment) => {
      const entry = usersById.get(enrollment.User.id) || {
        user: enrollment.User,
        enrolledCourses: [],
      };
      entry.enrolledCourses.push(enrollment.courseId);
      usersById.set(enrollment.User.id, entry);
    });

    res.json(
      Array.from(usersById.values()).map((entry) =>
        serializeAdminUser(entry.user, entry.enrolledCourses),
      ),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:id/toggle-block", protect, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id, role: "user" } });
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.update({ isBlocked: !user.isBlocked });
    const enrollments = await Enrollment.findAll({
      where: { userId: user.id },
      attributes: ["courseId"],
    });
    res.json(serializeAdminUser(user, enrollments.map((e) => e.courseId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/users/:id", protect, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id, role: "user" } });
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.destroy();
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/superadmin/stats — dashboard stats scoped to admin role
router.get("/stats", protect, adminOnly, async (req, res) => {
  try {
    const courseWhere = scopedCourseWhere(req.user);
    const courseIds = await getScopedCourseIds(req.user);
    const enrollmentWhere = courseIds ? { courseId: courseIds } : {};
    const paymentWhere = courseIds ? { courseId: courseIds, status: "success" } : { status: "success" };
    const [
      totalUsers,
      totalAdmins,
      totalCourses,
      totalEnrollments,
      totalCompleted,
      totalLessons,
      totalQuizzes,
      totalPayments,
      paidRevenue,
    ] = await Promise.all([
      courseIds?.length === 0
        ? 0
        : User.count({
            where: { role: "user" },
            include: courseIds
              ? [{ model: Enrollment, where: { courseId: courseIds }, required: true }]
              : [],
            distinct: true,
          }),
      req.user.role === "super-admin" ? User.count({ where: { role: "admin" } }) : 0,
      Course.count({ where: courseWhere }),
      courseIds?.length === 0 ? 0 : Enrollment.count({ where: enrollmentWhere }),
      courseIds?.length === 0
        ? 0
        : Enrollment.count({ where: { ...enrollmentWhere, isCompleted: true } }),
      Lesson.count({
        include: [
          {
            model: Module,
            required: true,
            include: [{ model: Course, required: true, where: courseWhere }],
          },
        ],
      }),
      Quiz.count({
        include: [{ model: Module, required: true, include: [{ model: Course, required: true, where: courseWhere }] }],
      }),
      courseIds?.length === 0 ? 0 : Payment.count({ where: paymentWhere }),
      courseIds?.length === 0 ? 0 : Payment.sum("amount", { where: paymentWhere }),
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
      totalPayments,
      totalRevenue: Number(paidRevenue || 0),
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
router.get("/user-growth", protect, adminOnly, async (req, res) => {
  try {
    if (req.user.role === "super-admin") return res.json(await getGrowthData(User));
    res.json(await getScopedGrowthData(Enrollment, req.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/superadmin/enrollment-growth — enrollments for the last six months
router.get("/enrollment-growth", protect, adminOnly, async (req, res) => {
  try {
    res.json(await getScopedGrowthData(Enrollment, req.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/course-completion", protect, adminOnly, async (req, res) => {
  try {
    const courseIds = await getScopedCourseIds(req.user);
    if (courseIds?.length === 0)
      return res.json({ completed: 0, inProgress: 0, notStarted: 0 });
    const where = courseIds ? { courseId: courseIds } : {};
    const [completed, total] = await Promise.all([
      Enrollment.count({ where: { ...where, isCompleted: true } }),
      Enrollment.count({ where }),
    ]);
    res.json({
      completed,
      inProgress: Math.max(total - completed, 0),
      notStarted: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/popular-courses", protect, adminOnly, async (req, res) => {
  try {
    const courseWhere = scopedCourseWhere(req.user);
    const topCourses = await Enrollment.findAll({
      attributes: [
        "courseId",
        [sequelize.fn("COUNT", sequelize.col("Enrollment.id")), "enrollments"],
      ],
      include: [{ model: Course, attributes: ["id", "title"], where: courseWhere }],
      group: ["courseId", "Course.id", "Course.title"],
      order: [[sequelize.fn("COUNT", sequelize.col("Enrollment.id")), "DESC"]],
      limit: 10,
    });
    res.json(
      topCourses.map((entry) => ({
        title: entry.Course?.title || "Untitled course",
        enrollments: Number(entry.dataValues.enrollments || 0),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/quiz-success", protect, adminOnly, async (_req, res) => {
  res.json({ labels: [], passed: [], failed: [] });
});

export default router;
