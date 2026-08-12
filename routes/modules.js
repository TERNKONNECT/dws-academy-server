import express from "express";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import { protect, optionalAuth } from "../middleware/auth.js";
import {
  requireCourseAccess,
  requireCourseOwnership,
} from "../middleware/courseAccess.js";
import { publicQuizOutline } from "../services/quizSerializer.js";

const router = express.Router({ mergeParams: true });

// Reads here return full lesson bodies, so they are gated exactly like
// GET /api/courses/:id is. Without this the paywall only covered one of the three
// paths that serve the same content.
router.use(optionalAuth);

// GET all modules for a course
router.get("/", requireCourseAccess, async (req, res, next) => {
  try {
    const modules = await Module.findAll({
      where: { courseId: req.course.id },
      order: [["order", "ASC"]],
    });

    const modulesWithContent = await Promise.all(
      modules.map(async (mod) => {
        const [lessons, quiz] = await Promise.all([
          Lesson.findAll({
            where: { moduleId: mod.id },
            order: [["order", "ASC"]],
          }),
          Quiz.findOne({ where: { moduleId: mod.id } }),
        ]);
        return {
          ...mod.toJSON(),
          lessons,
          quiz: publicQuizOutline(quiz, { includeQuestions: true }),
        };
      }),
    );

    res.json(modulesWithContent);
  } catch (err) {
    next(err);
  }
});

// GET single module
router.get("/:id", requireCourseAccess, async (req, res, next) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.course.id },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const [lessons, quiz] = await Promise.all([
      Lesson.findAll({
        where: { moduleId: mod.id },
        order: [["order", "ASC"]],
      }),
      Quiz.findOne({ where: { moduleId: mod.id } }),
    ]);

    res.json({
      ...mod.toJSON(),
      lessons,
      quiz: publicQuizOutline(quiz, { includeQuestions: true }),
    });
  } catch (err) {
    next(err);
  }
});

// POST create module
router.post("/", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const { title, order } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const mod = await Module.create({
      courseId: req.course.id,
      title,
      order,
    });
    res.status(201).json(mod);
  } catch (err) {
    next(err);
  }
});

// PUT update module
router.put("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.course.id },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const { title, order } = req.body;
    await mod.update({
      ...(title !== undefined ? { title } : {}),
      ...(order !== undefined ? { order } : {}),
    });
    res.json(mod);
  } catch (err) {
    next(err);
  }
});

// DELETE module (cascades to lessons and quiz)
router.delete("/:id", protect, requireCourseOwnership, async (req, res, next) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.course.id },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    await mod.destroy();
    res.json({ message: "Module deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
