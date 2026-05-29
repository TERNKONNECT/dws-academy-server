import express from "express";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Quiz from "../models/Quiz.js";
import Course from "../models/Course.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router({ mergeParams: true });

// GET all modules for a course
router.get("/", async (req, res) => {
  try {
    const modules = await Module.findAll({
      where: { courseId: req.params.courseId },
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
        return { ...mod.toJSON(), lessons, quiz };
      }),
    );

    res.json(modulesWithContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single module
router.get("/:id", async (req, res) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const [lessons, quiz] = await Promise.all([
      Lesson.findAll({
        where: { moduleId: mod.id },
        order: [["order", "ASC"]],
      }),
      Quiz.findOne({ where: { moduleId: mod.id } }),
    ]);

    res.json({ ...mod.toJSON(), lessons, quiz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create module
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const { title, order } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const mod = await Module.create({
      courseId: req.params.courseId,
      title,
      order,
    });
    res.status(201).json(mod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update module
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    await mod.update(req.body);
    res.json(mod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE module (cascades to lessons and quiz)
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const mod = await Module.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!mod) return res.status(404).json({ error: "Module not found" });
    await mod.destroy();
    res.json({ message: "Module deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
