import express from "express";
import Subscriber from "../models/Subscriber.js";

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

export default router;
