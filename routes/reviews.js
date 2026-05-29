import express from "express";
import Review from "../models/Review.js";
import Enrollment from "../models/Enrollment.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// POST /api/reviews/:courseId — submit a review (only completed students)
router.post("/:courseId", protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error: "Rating must be between 1 and 5" });

    // Must be enrolled and have completed the course
    const enrollment = await Enrollment.findOne({
      where: {
        userId: req.user.id,
        courseId: req.params.courseId,
        isCompleted: true,
      },
    });
    if (!enrollment)
      return res.status(403).json({
        error: "You must complete the course before leaving a review",
      });

    const [review, created] = await Review.findOrCreate({
      where: { courseId: req.params.courseId, userId: req.user.id },
      defaults: {
        courseId: req.params.courseId,
        userId: req.user.id,
        rating,
        comment,
      },
    });

    if (!created) {
      await review.update({ rating, comment });
    }

    res.status(created ? 201 : 200).json(review);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews/:courseId — get all reviews for a course (public)
router.get("/:courseId", async (req, res) => {
  try {
    const reviews = await Review.findAll({
      where: { courseId: req.params.courseId },
      include: [{ model: User, attributes: ["id", "name", "avatar"] }],
      order: [["createdAt", "DESC"]],
    });

    const avgRating =
      reviews.length > 0
        ? Math.round(
            (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10,
          ) / 10
        : 0;

    res.json({ avgRating, totalReviews: reviews.length, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reviews/:courseId/admin — admin sees reviews for their course
router.get("/:courseId/admin", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    if (req.user.role === "admin" && course.createdBy !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });

    const reviews = await Review.findAll({
      where: { courseId: req.params.courseId },
      include: [{ model: User, attributes: ["id", "name", "email", "avatar"] }],
      order: [["createdAt", "DESC"]],
    });

    const avgRating =
      reviews.length > 0
        ? Math.round(
            (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10,
          ) / 10
        : 0;

    res.json({ avgRating, totalReviews: reviews.length, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
