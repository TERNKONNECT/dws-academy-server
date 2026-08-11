import express from "express";
import Testimonial from "../models/Testimonial.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// GET /api/testimonials — get all active testimonials (public)
router.get("/", async (req, res) => {
  try {
    const testimonials = await Testimonial.findAll({
      where: { isActive: true },
      order: [["date", "DESC"], ["createdAt", "DESC"]],
      limit: 10,
    });
    res.json(testimonials);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/testimonials/admin — admin sees all testimonials
router.get("/admin", protect, adminOnly, async (req, res) => {
  try {
    const testimonials = await Testimonial.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json(testimonials);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/testimonials/admin — create a testimonial
router.post("/admin", protect, adminOnly, async (req, res) => {
  try {
    const { name, jobTitle, content, date, isActive } = req.body;
    
    if (!name || !jobTitle || !content) {
      return res.status(400).json({ error: "Name, job title, and content are required." });
    }
    
    const testimonial = await Testimonial.create({
      name,
      jobTitle,
      content,
      date: date || new Date(),
      isActive: isActive !== undefined ? isActive : true,
    });
    
    res.status(201).json(testimonial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/testimonials/admin/:id — update a testimonial
router.put("/admin/:id", protect, adminOnly, async (req, res) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    
    const { name, jobTitle, content, date, isActive } = req.body;
    
    await testimonial.update({
      name: name !== undefined ? name : testimonial.name,
      jobTitle: jobTitle !== undefined ? jobTitle : testimonial.jobTitle,
      content: content !== undefined ? content : testimonial.content,
      date: date !== undefined ? date : testimonial.date,
      isActive: isActive !== undefined ? isActive : testimonial.isActive,
    });
    
    res.json(testimonial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/testimonials/admin/:id — delete a testimonial
router.delete("/admin/:id", protect, adminOnly, async (req, res) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    
    await testimonial.destroy();
    res.json({ message: "Testimonial deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
