import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Enrollment from "../models/Enrollment.js";

// Roles that can read any course's content without enrolling, for review and support.
const PRIVILEGED_ROLES = new Set(["super-admin", "admin", "operator"]);
// Roles that can *change* content. Operators are read-only.
const CONTENT_EDITOR_ROLES = new Set(["super-admin", "admin"]);

/**
 * True when the caller may see full lesson bodies and media for this course.
 * Anyone else gets the locked outline only.
 */
export async function canAccessCourseContent(req, course) {
  if (!req.user) return false;
  if (PRIVILEGED_ROLES.has(req.user.role)) return true;

  const enrollment = await Enrollment.findOne({
    where: { userId: req.user.id, courseId: course.id },
  });
  return Boolean(enrollment);
}

/**
 * Resolves the course a route is operating on, from whichever id the URL carries.
 *
 * The courses router names it `:id`; sub-routers are mounted under
 * `/courses/:courseId`; lesson and quiz routes are also reachable by module id
 * alone. `courseParam` lets a caller name the param explicitly so, e.g., the
 * lessons router's `:id` (a lesson) is never mistaken for a course id.
 */
async function resolveCourse(req, courseParam) {
  if (courseParam && req.params[courseParam]) {
    return Course.findByPk(req.params[courseParam]);
  }
  if (req.params.courseId) {
    return Course.findByPk(req.params.courseId);
  }
  if (req.params.moduleId) {
    const mod = await Module.findByPk(req.params.moduleId);
    return mod ? Course.findByPk(mod.courseId) : null;
  }
  return null;
}

/**
 * Read gate for nested content routes (modules, lessons, quizzes).
 *
 * `routes/courses.js` gates its own responses; every other router that serves the
 * same lesson bodies has to go through here, or the paywall only covers one path
 * out of three.
 */
export function courseAccessGate(courseParam) {
  return async function requireCourseAccess(req, res, next) {
    try {
      const course = await resolveCourse(req, courseParam);
      if (!course) return res.status(404).json({ error: "Course not found" });

      if (!(await canAccessCourseContent(req, course))) {
        return res
          .status(403)
          .json({ error: "Enrol in this course to access its content" });
      }

      req.course = course;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Write gate for anything belonging to a course. Super-admins may edit any course;
 * an instructor may only edit courses they created.
 */
export function courseOwnershipGate(courseParam) {
  return async function requireCourseOwnership(req, res, next) {
    try {
      if (!CONTENT_EDITOR_ROLES.has(req.user?.role)) {
        return res
          .status(403)
          .json({ error: "Not authorized to change course content" });
      }

      const course = await resolveCourse(req, courseParam);
      if (!course) return res.status(404).json({ error: "Course not found" });

      if (req.user.role !== "super-admin" && course.createdBy !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Not authorized to change this course" });
      }

      req.course = course;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Default gates for sub-routers mounted under /courses/:courseId. */
export const requireCourseAccess = courseAccessGate();
export const requireCourseOwnership = courseOwnershipGate();
