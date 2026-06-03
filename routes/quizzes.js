import express from "express";
import Quiz from "../models/Quiz.js";
import Module from "../models/Module.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router({ mergeParams: true });

// GET quiz for a module
router.get("/", async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      where: { moduleId: req.params.moduleId },
    });
    if (!quiz)
      return res.status(404).json({ error: "No quiz for this module" });
    res.json(quiz);
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
