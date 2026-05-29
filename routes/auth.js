import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { protect, adminOnly, superAdminOnly } from "../middleware/auth.js";

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const userPayload = (user) => ({
  _id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isBlocked: false,
  enrolledCourses: [],
  quizScores: [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

// Public user registration
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: "Email already in use" });
    const user = await User.create({ name, email, password, role: "user" });
    res.status(201).json({ token: signToken(user), user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create admin — requires admin or super-admin
router.post("/register-admin", protect, adminOnly, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: "Email already in use" });
    const user = await User.create({ name, email, password, role: "admin" });
    res.status(201).json({ token: signToken(user), user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create super-admin — requires super-admin only
router.post(
  "/register-super-admin",
  protect,
  superAdminOnly,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password)
        return res.status(400).json({ error: "All fields are required" });
      const exists = await User.findOne({ where: { email } });
      if (exists)
        return res.status(400).json({ error: "Email already in use" });
      const user = await User.create({
        name,
        email,
        password,
        role: "super-admin",
      });
      res.status(201).json({ token: signToken(user), user: userPayload(user) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Login — all roles
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });
    const user = await User.findOne({ where: { email } });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: "Invalid email or password" });
    res.json({ token: signToken(user), user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
