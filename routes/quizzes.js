import express from "express";
import Quiz from "../models/Quiz.js";
import Module from "../models/Module.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import QuizAttempt from "../models/QuizAttempt.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router({ mergeParams: true });

const privilegedRoles = ["super-admin", "admin", "instructor", "staff"];

function normalizeQuestion(question, index) {
  const options =
    question.options ??
    [question.optionA, question.optionB, question.optionC, question.optionD].filter(
      (option) => option !== undefined && option !== null,
    );
  const correctAnswer =
    question.correctIndex ??
    question.correctAnswer ??
    (typeof question.answer === "number" ? question.answer : undefined);

  return {
    ...question,
    _id: question._id ?? question.id ?? `q-${index}`,
    text: question.text ?? question.question ?? "",
    options: Array.isArray(options) ? options : [],
    correctIndex: Number.isInteger(correctAnswer) ? correctAnswer : 0,
    type: question.type === "theory" ? "theory" : "mcq",
    sampleAnswer: question.sampleAnswer ?? "",
  };
}

function serializeQuiz(quiz) {
  const data = quiz.toJSON ? quiz.toJSON() : quiz;
  return {
    ...data,
    questions: (data.questions ?? []).map(normalizeQuestion),
  };
}

async function getQuizCourse(quiz) {
  const mod = await Module.findByPk(quiz.moduleId);
  if (!mod) return { module: null, course: null };
  const course = await Course.findByPk(mod.courseId);
  return { module: mod, course };
}

async function requireQuizAccess(req, quiz) {
  const { module, course } = await getQuizCourse(quiz);
  if (!module || !course) return { allowed: false, status: 404 };
  if (privilegedRoles.includes(req.user.role)) {
    return { allowed: true, module, course };
  }
  const enrollment = await Enrollment.findOne({
    where: { userId: req.user.id, courseId: course.id },
  });
  if (!enrollment) return { allowed: false, status: 403 };
  return { allowed: true, module, course, enrollment };
}

function gradeQuiz(quiz, answers = {}) {
  const questions = (quiz.questions ?? []).map(normalizeQuestion);
  const gradable = questions.filter((question) => question.type !== "theory");
  const score = gradable.reduce((total, question) => {
    const answer = answers[question._id] ?? answers[question.id];
    return total + (Number(answer) === question.correctIndex ? 1 : 0);
  }, 0);
  const percentage =
    gradable.length > 0 ? Math.round((score / gradable.length) * 100) : 100;

  return {
    score,
    totalQuestions: gradable.length,
    percentage,
    passed: percentage >= 80,
  };
}

// GET quiz directly by id for learners taking quizzes
router.get("/:quizId", protect, async (req, res) => {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const access = await requireQuizAccess(req, quiz);
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ error: "Not authorized to access this quiz" });
    }

    res.json({ ...serializeQuiz(quiz), courseId: access.course.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST submit quiz answers and persist the graded attempt
router.post("/:quizId/submit", protect, async (req, res) => {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    const access = await requireQuizAccess(req, quiz);
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ error: "Not authorized to submit this quiz" });
    }

    if (!access.enrollment) {
      // Admins/super-admins can preview quiz results without persisting
      if (privilegedRoles.includes(req.user.role)) {
        const answers = req.body.answers ?? {};
        const result = gradeQuiz(serializeQuiz(quiz), answers);
        return res.status(200).json({
          preview: true,
          quiz: { ...serializeQuiz(quiz), courseId: access.course.id },
          ...result,
          completedAt: new Date(),
        });
      }
      return res
        .status(403)
        .json({ error: "Only enrolled students can submit quiz attempts" });
    }

    const answers = req.body.answers ?? {};
    const result = gradeQuiz(serializeQuiz(quiz), answers);
    const attempt = await QuizAttempt.create({
      enrollmentId: access.enrollment.id,
      quizId: quiz.id,
      answers,
      ...result,
      completedAt: new Date(),
    });

    if (result.passed) {
      await access.enrollment.update({
        isCompleted: true,
        completedAt: access.enrollment.completedAt ?? new Date(),
      });
    }

    res.status(201).json({
      attemptId: attempt.id,
      quiz: { ...serializeQuiz(quiz), courseId: access.course.id },
      ...result,
      completedAt: attempt.completedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET quiz for a module (or all quizzes if moduleId not present)
router.get("/", async (req, res) => {
  try {
    if (!req.params.moduleId) {
      const quizzes = await Quiz.findAll();
      return res.json(quizzes.map(serializeQuiz));
    }
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz)
      return res.status(404).json({ error: "No quiz for this module" });
    res.json(serializeQuiz(quiz));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create quiz for a module
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findByPk(req.params.moduleId);
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
    res.status(201).json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update quiz
router.put("/", protect, adminOnly, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    await quiz.update(req.body);
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE quiz
router.delete("/", protect, adminOnly, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    await quiz.destroy();
    res.json({ message: "Quiz deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
