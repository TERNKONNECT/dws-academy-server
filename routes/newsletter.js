import express from "express";
import { Op } from "sequelize";
import Subscriber from "../models/Subscriber.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/", async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    const [, created] = await Subscriber.findOrCreate({ where: { email } });
    res.status(created ? 201 : 200).json({
      message: created ? "Subscribed successfully" : "You're already subscribed",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const subscribers = await Subscriber.findAll({
      where,
      order: [["createdAt", "DESC"]],
      attributes: ["id", "email", "createdAt"],
    });

    res.json(subscribers);
  } catch (err) {
    next(err);
  }
});

router.put("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    const subscriber = await Subscriber.findByPk(req.params.id);
    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found" });
    }

    // Check if new email is already taken by another subscriber
    const existing = await Subscriber.findOne({ where: { email } });
    if (existing && existing.id !== subscriber.id) {
      return res.status(400).json({ error: "Email is already subscribed" });
    }

    subscriber.email = email;
    await subscriber.save();

    res.json(subscriber);
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const subscriber = await Subscriber.findByPk(req.params.id);
    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found" });
    }

    await subscriber.destroy();
    res.json({ message: "Subscriber removed" });
  } catch (err) {
    next(err);
  }
});

export default router;
