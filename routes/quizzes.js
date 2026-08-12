import express from "express";
import Quiz from "../models/Quiz.js";
import Module from "../models/Module.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import QuizAttempt from "../models/QuizAttempt.js";
import { protect } from "../middleware/auth.js";
import { requireCourseOwnership } from "../middleware/courseAccess.js";
import {
  authorQuiz,
  gradeQuiz,
  publicQuiz,
  publicQuizOutline,
} from "../services/quizSerializer.js";
import { PASS_PERCENTAGE, syncCourseCompletion } from "../services/completion.js";

const router = express.Router({ mergeParams: true });

// Roles that may see a quiz's answers, because they are the ones who wrote it.
const AUTHOR_ROLES = new Set(["super-admin", "admin"]);
// Roles that may read a quiz without enrolling.
const PRIVILEGED_ROLES = new Set(["super-admin", "admin", "operator"]);

async function getQuizCourse(quiz) {
  const mod = await Module.findByPk(quiz.moduleId);
  if (!mod) return { module: null, course: null };
  const course = await Course.findByPk(mod.courseId);
  return { module: mod, course };
}

async function requireQuizAccess(req, quiz) {
  const { module, course } = await getQuizCourse(quiz);
  if (!module || !course) return { allowed: false, status: 404 };

  if (PRIVILEGED_ROLES.has(req.user.role)) {
    return { allowed: true, module, course };
  }

  const enrollment = await Enrollment.findOne({
    where: { userId: req.user.id, courseId: course.id },
  });
  if (!enrollment) return { allowed: false, status: 403 };
  return { allowed: true, module, course, enrollment };
}

/**
 * Whether this caller may see the answer key: super-admins, and the instructor who
 * owns the course the quiz belongs to. Students never do, enrolled or not.
 */
function canSeeAnswers(req, course) {
  if (!AUTHOR_ROLES.has(req.user?.role)) return false;
  return req.user.role === "super-admin" || course.createdBy === req.user.id;
}

// GET quiz by id, for learners taking it and authors editing it
router.get("/:quizId", protect, async (req, res, next) => {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const access = await requireQuizAccess(req, quiz);
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ error: "Not authorized to access this quiz" });
    }

    const body = canSeeAnswers(req, access.course)
      ? authorQuiz(quiz)
      : publicQuiz(quiz);

    res.json({ ...body, courseId: access.course.id });
  } catch (err) {
    next(err);
  }
});

// POST submit quiz answers and persist the graded attempt
router.post("/:quizId/submit", protect, async (req, res, next) => {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const access = await requireQuizAccess(req, quiz);
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ error: "Not authorized to submit this quiz" });
    }

    const answers = req.body.answers ?? {};
    const result = gradeQuiz(authorQuiz(quiz), answers, PASS_PERCENTAGE);

    if (!access.enrollment) {
      // Staff can try a quiz to check it without persisting an attempt.
      if (PRIVILEGED_ROLES.has(req.user.role)) {
        return res.status(200).json({
          preview: true,
          quiz: {
            ...publicQuizOutline(quiz, { includeQuestions: true }),
            courseId: access.course.id,
          },
          ...result,
          completedAt: new Date(),
        });
      }
      return res
        .status(403)
        .json({ error: "Only enrolled students can submit quiz attempts" });
    }

    const attempt = await QuizAttempt.create({
      enrollmentId: access.enrollment.id,
      quizId: quiz.id,
      answers,
      ...result,
      completedAt: new Date(),
    });

    // Completion is derived from the whole course — every lesson done and every
    // module quiz passed — not asserted by whichever quiz happened to be submitted.
    const completion = await syncCourseCompletion(access.enrollment);

    res.status(201).json({
      attemptId: attempt.id,
      quiz: {
        ...publicQuizOutline(quiz, { includeQuestions: true }),
        courseId: access.course.id,
      },
      ...result,
      courseCompleted: completion.isCompleted,
      completedAt: attempt.completedAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET the quiz for a module. Only reachable via /courses/:courseId/modules/:moduleId/quiz;
// mounting this router at /api/quizzes no longer exposes a list-everything branch.
router.get("/", protect, async (req, res, next) => {
  try {
    if (!req.params.moduleId) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz)
      return res.status(404).json({ error: "No quiz for this module" });

    const access = await requireQuizAccess(req, quiz);
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ error: "Not authorized to access this quiz" });
    }

    res.json(
      canSeeAnswers(req, access.course) ? authorQuiz(quiz) : publicQuiz(quiz),
    );
  } catch (err) {
    next(err);
  }
});

// POST create quiz for a module
router.post("/", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.moduleId, courseId: req.course.id },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const existing = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (existing)
      return res.status(400).json({
        error: "This module already has a quiz. Use PUT to update it.",
      });

    const { title, description, questions } = req.body;
    if (!questions || questions.length === 0)
      return res
        .status(400)
        .json({ error: "Quiz must have at least one question" });

    const quiz = await Quiz.create({
      moduleId: req.params.moduleId,
      title,
      description,
      questions,
    });
    res.status(201).json(authorQuiz(quiz));
  } catch (err) {
    next(err);
  }
});

// PUT update quiz
router.put("/", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const { title, description, questions } = req.body;
    await quiz.update({
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(questions !== undefined ? { questions } : {}),
    });
    res.json(authorQuiz(quiz));
  } catch (err) {
    next(err);
  }
});

// DELETE quiz
router.delete("/", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    await quiz.destroy();
    res.json({ message: "Quiz deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
