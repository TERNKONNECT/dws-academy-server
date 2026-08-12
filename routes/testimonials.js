import express from "express";
import Testimonial from "../models/Testimonial.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// GET /api/testimonials — get all active testimonials (public)
router.get("/", async (req, res, next) => {
  try {
    const testimonials = await Testimonial.findAll({
      where: { isActive: true },
      order: [["date", "DESC"], ["createdAt", "DESC"]],
      limit: 10,
    });
    res.json(testimonials);
  } catch (err) {
    next(err);
  }
});

// GET /api/testimonials/admin — admin sees all testimonials
router.get("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonials = await Testimonial.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json(testimonials);
  } catch (err) {
    next(err);
  }
});

// POST /api/testimonials/admin — create a testimonial
router.post("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const { name, jobTitle, companyName, content, date, isActive } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ error: "Name and content are required." });
    }
    
    const testimonial = await Testimonial.create({
      name,
      jobTitle: jobTitle || "",
      companyName: companyName || "",
      content,
      date: date || new Date(),
      isActive: isActive !== undefined ? isActive : true,
    });
    
    res.status(201).json(testimonial);
  } catch (err) {
    next(err);
  }
});

// PUT /api/testimonials/admin/:id — update a testimonial
router.put("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    
    const { name, jobTitle, companyName, content, date, isActive } = req.body;
    
    await testimonial.update({
      name: name !== undefined ? name : testimonial.name,
      jobTitle: jobTitle !== undefined ? jobTitle : testimonial.jobTitle,
      companyName: companyName !== undefined ? companyName : testimonial.companyName,
      content: content !== undefined ? content : testimonial.content,
      date: date !== undefined ? date : testimonial.date,
      isActive: isActive !== undefined ? isActive : testimonial.isActive,
    });
    
    res.json(testimonial);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/testimonials/admin/:id — delete a testimonial
router.delete("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }
    
    await testimonial.destroy();
    res.json({ message: "Testimonial deleted successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
