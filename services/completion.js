import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import LessonProgress from "../models/LessonProgress.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";

export const PASS_PERCENTAGE = 80;

/**
 * Counts lessons per course in one query instead of one query per course.
 * Returns a Map of courseId → lesson count.
 */
export async function countLessonsByCourse(courseIds) {
  if (!courseIds.length) return new Map();

  const rows = await Lesson.findAll({
    attributes: [
      [Lesson.sequelize.col("Module.courseId"), "courseId"],
      [Lesson.sequelize.fn("COUNT", Lesson.sequelize.col("Lesson.id")), "count"],
    ],
    include: [
      { model: Module, attributes: [], where: { courseId: courseIds }, required: true },
    ],
    group: [Lesson.sequelize.col("Module.courseId")],
    raw: true,
  });

  return new Map(rows.map((r) => [r.courseId, Number(r.count)]));
}

/**
 * Counts completed lessons per enrollment in one query.
 * Returns a Map of enrollmentId → completed count.
 */
export async function countProgressByEnrollment(enrollmentIds) {
  if (!enrollmentIds.length) return new Map();

  const rows = await LessonProgress.findAll({
    attributes: [
      "enrollmentId",
      [LessonProgress.sequelize.fn("COUNT", LessonProgress.sequelize.col("id")), "count"],
    ],
    where: { enrollmentId: enrollmentIds },
    group: ["enrollmentId"],
    raw: true,
  });

  return new Map(rows.map((r) => [r.enrollmentId, Number(r.count)]));
}

/**
 * The single definition of "this student finished the course": every lesson marked
 * complete, and every module quiz passed.
 *
 * Both the lesson-complete route and the quiz-submit route call this, so neither can
 * decide on its own that the course is done — previously, passing one module quiz
 * completed a ten-module course.
 */
export async function evaluateCourseCompletion(enrollment) {
  const modules = await Module.findAll({
    where: { courseId: enrollment.courseId },
    attributes: ["id"],
  });
  const moduleIds = modules.map((m) => m.id);

  const totalLessons = moduleIds.length
    ? await Lesson.count({ where: { moduleId: moduleIds } })
    : 0;
  const completedLessons = await LessonProgress.count({
    where: { enrollmentId: enrollment.id },
  });

  const quizzes = moduleIds.length
    ? await Quiz.findAll({ where: { moduleId: moduleIds }, attributes: ["id"] })
    : [];

  let passedQuizzes = 0;
  if (quizzes.length) {
    const passedRows = await QuizAttempt.findAll({
      attributes: ["quizId"],
      where: {
        enrollmentId: enrollment.id,
        quizId: quizzes.map((q) => q.id),
        passed: true,
      },
      group: ["quizId"],
      raw: true,
    });
    passedQuizzes = passedRows.length;
  }

  // A course with no lessons and no quizzes is never "completed" — there is nothing
  // to complete, and treating it as done would mint certificates for empty courses.
  const hasContent = totalLessons > 0 || quizzes.length > 0;
  const isCompleted =
    hasContent &&
    completedLessons >= totalLessons &&
    passedQuizzes >= quizzes.length;

  return {
    totalLessons,
    completedLessons,
    totalQuizzes: quizzes.length,
    passedQuizzes,
    isCompleted,
    progressPct:
      totalLessons > 0
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0,
  };
}

/**
 * Recomputes completion and persists the flag if it changed.
 */
export async function syncCourseCompletion(enrollment) {
  const result = await evaluateCourseCompletion(enrollment);

  if (result.isCompleted && !enrollment.isCompleted) {
    await enrollment.update({ isCompleted: true, completedAt: new Date() });
  } else if (!result.isCompleted && enrollment.isCompleted) {
    await enrollment.update({ isCompleted: false, completedAt: null });
  }

  return result;
}
