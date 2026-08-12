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
import {
  adminInviteEmailTemplate,
  appUrl,
  sendEmail,
} from "../config/email.js";
import { protect, superAdminOnly, strictAdminOnly } from "../middleware/auth.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import {
  countLessonsByCourse,
  countProgressByEnrollment,
} from "../services/completion.js";

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

async function getGrowthData(Model, extraWhere = {}) {
  const months = getLastSixMonths();
  const countsByMonth = Object.fromEntries(months.map((month) => [month.key, 0]));

  const records = await Model.findAll({
    attributes: ["createdAt"],
    where: {
      ...extraWhere,
      createdAt: { [Op.gte]: months[0].start }
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

// GET /api/superadmin/users — all users (learners)
router.get("/users", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { search } = req.query;
    let whereClause = { role: "user" };
    if (search) {
      whereClause = {
        ...whereClause,
        [Op.or]: [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
        ],
      };
    }
    const users = await User.findAll({
      where: whereClause,
      attributes: ["id", "name", "email", "role", "isBlocked", "createdAt", "updatedAt", "avatar"],
      order: [["createdAt", "DESC"]],
    });

    const userIds = users.map((u) => u.id);
    const enrollments = await Enrollment.findAll({
      where: { userId: userIds },
      attributes: ["userId", "courseId"],
    });

    const userEnrollments = {};
    enrollments.forEach((e) => {
      if (!userEnrollments[e.userId]) userEnrollments[e.userId] = [];
      userEnrollments[e.userId].push(e.courseId);
    });

    const mappedUsers = users.map((u) => ({
      ...u.toJSON(),
      _id: u.id,
      enrolledCourses: userEnrollments[u.id] || [],
    }));
    res.json(mappedUsers);
  } catch (err) {
    next(err);
  }
});

// These two routes are the reason `strictAdminOnly` was the wrong guard: they take a
// user id straight from the URL and never looked at whose account it was. Now they
// are super-admin only *and* refuse to touch anything that isn't a learner, so the
// last super-admin can't be deleted and admins can't be removed sideways.
function rejectPrivilegedTarget(user, res) {
  if (user.role !== "user") {
    res.status(403).json({
      error: "Only learner accounts can be managed here. Manage staff under Instructors.",
    });
    return true;
  }
  return false;
}

// PUT /api/superadmin/users/:id/toggle-block
router.put("/users/:id/toggle-block", protect, superAdminOnly, async (req, res, next) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (rejectPrivilegedTarget(user, res)) return;

    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({ ...user.toJSON(), _id: user.id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/superadmin/users/:id
router.delete("/users/:id", protect, superAdminOnly, async (req, res, next) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (rejectPrivilegedTarget(user, res)) return;
    if (user.id === req.user.id)
      return res.status(400).json({ error: "You cannot delete your own account" });

    await user.destroy();
    res.json({ message: "User deleted" });
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/instructors — all admins with their course counts
router.get("/instructors", protect, superAdminOnly, async (req, res, next) => {
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

    // Three grouped queries for the whole page, rather than three per instructor.
    const courses = await Course.findAll({
      where: { createdBy: instructors.map((i) => i.id) },
      attributes: ["id", "createdBy"],
      raw: true,
    });

    const courseIdsByInstructor = new Map();
    const instructorByCourse = new Map();
    for (const course of courses) {
      const list = courseIdsByInstructor.get(course.createdBy) ?? [];
      list.push(course.id);
      courseIdsByInstructor.set(course.createdBy, list);
      instructorByCourse.set(course.id, course.createdBy);
    }

    const enrollmentRows = courses.length
      ? await Enrollment.findAll({
          attributes: [
            "courseId",
            [sequelize.fn("COUNT", sequelize.col("id")), "total"],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN "isCompleted" THEN 1 ELSE 0 END`),
              ),
              "completed",
            ],
          ],
          where: { courseId: courses.map((c) => c.id) },
          group: ["courseId"],
          raw: true,
        })
      : [];

    const totals = new Map();
    for (const row of enrollmentRows) {
      const instructorId = instructorByCourse.get(row.courseId);
      const acc = totals.get(instructorId) ?? { enrollments: 0, completed: 0 };
      acc.enrollments += Number(row.total) || 0;
      acc.completed += Number(row.completed) || 0;
      totals.set(instructorId, acc);
    }

    res.json(
      instructors.map((instructor) => {
        const { enrollments: totalEnrollments = 0, completed: totalCompleted = 0 } =
          totals.get(instructor.id) ?? {};
        return {
          id: instructor.id,
          name: instructor.name,
          email: instructor.email,
          joinedAt: instructor.createdAt,
          inviteStatus: instructor.passwordSetupRequired ? "pending" : "accepted",
          inviteExpiresAt: instructor.adminInviteExpires,
          totalCourses: (courseIdsByInstructor.get(instructor.id) ?? []).length,
          totalEnrollments,
          totalCompleted,
          completionRate:
            totalEnrollments > 0
              ? Math.round((totalCompleted / totalEnrollments) * 100)
              : 0,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/instructors/:id — one instructor's full details + courses
// POST /api/superadmin/instructors/invite - invite a new admin by email
router.post("/instructors/invite", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { name, email, role } = req.body;
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
        role: role === "operator" ? "operator" : "admin",
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
    next(err);
  }
});

router.get("/instructors/:id", protect, superAdminOnly, async (req, res, next) => {
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

    // Two grouped queries up front, then everything below is in-memory joins.
    const courseIds = courses.map((c) => c.id);
    const allEnrollments = courseIds.length
      ? await Enrollment.findAll({
          where: { courseId: courseIds },
          include: [{ model: User, attributes: ["id", "name", "email"] }],
        })
      : [];

    const [lessonCounts, progressCounts] = await Promise.all([
      countLessonsByCourse(courseIds),
      countProgressByEnrollment(allEnrollments.map((e) => e.id)),
    ]);

    const enrollmentsByCourse = new Map();
    for (const enrollment of allEnrollments) {
      const list = enrollmentsByCourse.get(enrollment.courseId) ?? [];
      list.push(enrollment);
      enrollmentsByCourse.set(enrollment.courseId, list);
    }

    const coursesWithStats = await Promise.all(
      courses.map(async (course) => {
        const totalLessons = lessonCounts.get(course.id) ?? 0;
        const enrollments = enrollmentsByCourse.get(course.id) ?? [];

        const studentsWithProgress = enrollments.map((e) => {
          const completedLessons = progressCounts.get(e.id) ?? 0;
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
        });

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
    next(err);
  }
});

// GET /api/superadmin/stats — platform-wide or instructor-specific stats
router.get("/stats", protect, strictAdminOnly, async (req, res, next) => {
  try {
    let totalUsers, totalAdmins, totalCourses, totalEnrollments, totalCompleted, totalLessons, totalQuizzes, activeUsers, totalRevenue;
    let recentActivity = [];

    if (req.user.role === "super-admin") {
      [
        totalUsers,
        totalAdmins,
        totalCourses,
        totalEnrollments,
        totalCompleted,
        totalLessons,
        totalQuizzes,
        totalRevenue,
      ] = await Promise.all([
        User.count({ where: { role: "user" } }),
        User.count({ where: { role: "admin" } }),
        Course.count(),
        Enrollment.count(),
        Enrollment.count({ where: { isCompleted: true } }),
        Lesson.count(),
        Quiz.count(),
        Payment.sum("amount", { where: { status: "success" } }),
      ]);
      totalRevenue = Number(totalRevenue) || 0;
      activeUsers = totalUsers;

      // Fetch platform-wide recent activity: recent enrollments
      const recentEnrollments = await Enrollment.findAll({
        limit: 5,
        order: [["createdAt", "DESC"]],
        include: [
          { model: User, attributes: ["name"] },
          { model: Course, attributes: ["title"] }
        ]
      });

      recentEnrollments.forEach((e) => {
        recentActivity.push({
          activity: e.isCompleted ? `Completed course: ${e.Course?.title}` : `Enrolled in ${e.Course?.title}`,
          user: e.User?.name || "Unknown Student",
          date: e.updatedAt || e.createdAt,
        });
      });

      // Fetch recent course publications
      const recentCourses = await Course.findAll({
        limit: 5,
        order: [["createdAt", "DESC"]],
        include: [
          { model: User, as: "instructor", attributes: ["name"] }
        ]
      });

      recentCourses.forEach((c) => {
        recentActivity.push({
          activity: c.status === "published" ? `New course published: ${c.title}` : `New course drafted: ${c.title}`,
          user: c.instructor?.name || "Admin",
          date: c.createdAt,
        });
      });

    } else {
      // Regular admin (instructor)
      const instructorId = req.user.id;
      const courses = await Course.findAll({
        where: { createdBy: instructorId },
        attributes: ["id", "title", "createdAt", "updatedAt"]
      });
      const courseIds = courses.map((c) => c.id);

      totalAdmins = 0;
      if (courseIds.length > 0) {
        [
          totalCourses,
          totalEnrollments,
          totalCompleted,
          totalLessons,
          totalQuizzes,
          totalUsers,
        ] = await Promise.all([
          Promise.resolve(courseIds.length),
          Enrollment.count({ where: { courseId: courseIds } }),
          Enrollment.count({ where: { courseId: courseIds, isCompleted: true } }),
          Lesson.count({
            include: [{
              model: Module,
              where: { courseId: courseIds },
              required: true
            }]
          }),
          Quiz.count({
            include: [{
              model: Module,
              where: { courseId: courseIds },
              required: true
            }]
          }),
          Enrollment.count({
            distinct: true,
            col: "userId",
            where: { courseId: courseIds }
          }),
        ]);
        activeUsers = totalUsers;
        totalRevenue = Number(
          await Payment.sum("amount", { where: { courseId: courseIds, status: "success" } }),
        ) || 0;

        // Fetch instructor-specific recent activity: enrollments in their courses
        const recentEnrollments = await Enrollment.findAll({
          where: { courseId: courseIds },
          limit: 5,
          order: [["createdAt", "DESC"]],
          include: [
            { model: User, attributes: ["name"] },
            { model: Course, attributes: ["title"] }
          ]
        });

        recentEnrollments.forEach((e) => {
          recentActivity.push({
            activity: e.isCompleted ? `Completed course: ${e.Course?.title}` : `Enrolled in ${e.Course?.title}`,
            user: e.User?.name || "Unknown Student",
            date: e.updatedAt || e.createdAt,
          });
        });

        // Fetch instructor's course activities
        courses.forEach((c) => {
          recentActivity.push({
            activity: c.createdAt.getTime() === c.updatedAt.getTime() ? `New course drafted: ${c.title}` : `Updated course: ${c.title}`,
            user: "You",
            date: c.updatedAt || c.createdAt,
          });
        });

      } else {
        totalCourses = 0;
        totalEnrollments = 0;
        totalCompleted = 0;
        totalLessons = 0;
        totalQuizzes = 0;
        totalUsers = 0;
        activeUsers = 0;
        totalRevenue = 0;
      }
    }

    // Sort recent activity by date descending, limit to 5
    recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    recentActivity = recentActivity.slice(0, 5);

    res.json({
      totalUsers,
      totalAdmins,
      totalCourses,
      totalEnrollments,
      totalLessons,
      totalQuizzes,
      activeUsers,
      totalCompleted,
      totalRevenue,
      completionRate:
        totalEnrollments > 0
          ? Math.round((totalCompleted / totalEnrollments) * 100)
          : 0,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/user-growth — user signups for the last six months
router.get("/user-growth", protect, strictAdminOnly, async (req, res, next) => {
  try {
    if (req.user.role === "super-admin") {
      res.json(await getGrowthData(User));
    } else {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      const courseIds = courses.map((c) => c.id);
      
      const enrollments = await Enrollment.findAll({
        where: { courseId: courseIds },
        attributes: ["userId"],
        group: ["userId"]
      });
      const userIds = enrollments.map((e) => e.userId);
      res.json(await getGrowthData(User, { id: userIds }));
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/enrollment-growth — enrollments for the last six months
router.get("/enrollment-growth", protect, strictAdminOnly, async (req, res, next) => {
  try {
    if (req.user.role === "super-admin") {
      res.json(await getGrowthData(Enrollment));
    } else {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      const courseIds = courses.map((c) => c.id);
      res.json(await getGrowthData(Enrollment, { courseId: courseIds }));
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/course-completion — course completion statistics
router.get("/course-completion", protect, strictAdminOnly, async (req, res, next) => {
  try {
    let whereClause = {};
    if (req.user.role !== "super-admin") {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      const courseIds = courses.map((c) => c.id);
      whereClause = { courseId: courseIds };
    }

    const enrollments = await Enrollment.findAll({
      where: whereClause,
      attributes: ["id", "isCompleted"],
    });

    if (enrollments.length === 0) {
      return res.json({ completed: 0, inProgress: 0, notStarted: 0 });
    }

    const enrollmentIds = enrollments.map((e) => e.id);
    const progressRecords = await LessonProgress.findAll({
      where: { enrollmentId: enrollmentIds },
      attributes: ["enrollmentId"],
    });

    const progressCounts = {};
    progressRecords.forEach((pr) => {
      progressCounts[pr.enrollmentId] = (progressCounts[pr.enrollmentId] || 0) + 1;
    });

    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;

    enrollments.forEach((e) => {
      if (e.isCompleted) {
        completed++;
      } else if (progressCounts[e.id] > 0) {
        inProgress++;
      } else {
        notStarted++;
      }
    });

    res.json({ completed, inProgress, notStarted });
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/quiz-success — quiz success rates
router.get("/quiz-success", protect, strictAdminOnly, async (req, res, next) => {
  try {
    let courseIds = null;
    if (req.user.role !== "super-admin") {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      courseIds = courses.map((c) => c.id);
    }

    const quizInclude = {
      model: Module,
      required: true,
      include: [{
        model: Course,
        required: true,
        attributes: ["id", "title"]
      }]
    };
    if (courseIds) {
      quizInclude.where = { courseId: courseIds };
    }

    const quizzes = await Quiz.findAll({
      include: [quizInclude]
    });

    // One grouped count for every course involved, instead of two per quiz.
    const quizCourseIds = [...new Set(quizzes.map((q) => q.Module.Course.id))];
    const rows = quizCourseIds.length
      ? await Enrollment.findAll({
          attributes: [
            "courseId",
            [sequelize.fn("COUNT", sequelize.col("id")), "total"],
            [
              sequelize.fn(
                "SUM",
                sequelize.literal(`CASE WHEN "isCompleted" THEN 1 ELSE 0 END`),
              ),
              "completed",
            ],
          ],
          where: { courseId: quizCourseIds },
          group: ["courseId"],
          raw: true,
        })
      : [];

    const byCourse = new Map(
      rows.map((r) => [
        r.courseId,
        { total: Number(r.total) || 0, completed: Number(r.completed) || 0 },
      ]),
    );

    const labels = [];
    const passed = [];
    const failed = [];

    for (const quiz of quizzes) {
      const stats = byCourse.get(quiz.Module.Course.id) ?? {
        total: 0,
        completed: 0,
      };
      labels.push(quiz.title);
      passed.push(stats.completed);
      failed.push(Math.max(0, stats.total - stats.completed));
    }

    res.json({ labels, passed, failed });
  } catch (err) {
    next(err);
  }
});

// GET /api/superadmin/popular-courses — top courses by enrollment
router.get("/popular-courses", protect, strictAdminOnly, async (req, res, next) => {
  try {
    let courseWhere = {};
    if (req.user.role !== "super-admin") {
      courseWhere = { createdBy: req.user.id };
    }

    const courses = await Course.findAll({
      where: courseWhere,
      attributes: ["id", "title"],
    });

    const counts = courses.length
      ? await Enrollment.findAll({
          attributes: [
            "courseId",
            [sequelize.fn("COUNT", sequelize.col("id")), "count"],
          ],
          where: { courseId: courses.map((c) => c.id) },
          group: ["courseId"],
          raw: true,
        })
      : [];

    const countByCourse = new Map(
      counts.map((r) => [r.courseId, Number(r.count) || 0]),
    );

    const popular = courses
      .map((course) => ({
        title: course.title,
        enrollments: countByCourse.get(course.id) ?? 0,
      }))
      .sort((a, b) => b.enrollments - a.enrollments);

    res.json(popular.slice(0, 5));
  } catch (err) {
    next(err);
  }
});

export default router;
