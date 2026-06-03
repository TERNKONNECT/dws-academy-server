import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import {
  appUrl,
  passwordResetEmailTemplate,
  sendEmail,
  verificationEmailTemplate,
} from "../config/email.js";
import { protect, superAdminOnly } from "../middleware/auth.js";

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

const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeEmail = (email) => email.toLowerCase().trim();
const tokenExpiry = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

async function sendVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = hashValue(token);
  user.emailVerificationExpires = tokenExpiry(60 * 24);
  await user.save();

  const link = appUrl(`/verify-email?token=${token}&email=${encodeURIComponent(user.email)}`);
  const emailResult = await sendEmail({
    to: user.email,
    subject: "Verify your DWS Academy account",
    html: verificationEmailTemplate({ name: user.name, link }),
  });

  if (emailResult?.skipped) {
    console.warn(`Verification link for ${user.email}: ${link}`);
  }

  return {
    link,
    skipped: Boolean(emailResult?.skipped),
  };
}

async function sendPasswordResetEmail(user, otp) {
  await sendEmail({
    to: user.email,
    subject: "Your DWS Academy password reset code",
    html: passwordResetEmailTemplate({ name: user.name, otp }),
  });
}

function hasValidAdminInvite(user, token) {
  return (
    user &&
    user.role === "admin" &&
    user.passwordSetupRequired &&
    user.adminInviteToken === hashValue(String(token)) &&
    user.adminInviteExpires &&
    user.adminInviteExpires > new Date()
  );
}

// Public user registration
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });
    const normalizedEmail = normalizeEmail(email);
    const exists = await User.findOne({ where: { email: normalizedEmail } });
    if (exists) {
      if (exists.role === "user" && !exists.emailVerified) {
        exists.name = name;
        exists.password = password;
        exists.adminInviteToken = null;
        exists.adminInviteExpires = null;
        exists.passwordSetupRequired = false;
        const verification = await sendVerificationEmail(exists);
        return res.status(200).json({
          message: verification.skipped
            ? "Account updated. Verification email could not be sent in Resend testing mode. Use the verification link from the server logs."
            : "Account updated. Verification email resent. Check your inbox.",
          verificationLink:
            verification.skipped && process.env.NODE_ENV !== "production"
              ? verification.link
              : undefined,
        });
      }
      return res.status(400).json({ error: "Email already in use" });
    }
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: "user",
      emailVerified: false,
      adminInviteToken: null,
      adminInviteExpires: null,
      passwordSetupRequired: false,
    });
    const verification = await sendVerificationEmail(user);
    res.status(201).json({
      message: verification.skipped
        ? "Account created. Verification email could not be sent in Resend testing mode. Use the verification link from the server logs."
        : "Account created. Check your email to verify your account.",
      verificationLink:
        verification.skipped && process.env.NODE_ENV !== "production"
          ? verification.link
          : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/verify-email", async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email)
      return res.status(400).json({ error: "Verification token is required" });

    const user = await User.findOne({
      where: { email: normalizeEmail(String(email)) },
    });

    if (
      !user ||
      user.emailVerificationToken !== hashValue(String(token)) ||
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired verification link" });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.json({ message: "Email verified. You can now log in." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create admin — requires admin or super-admin
// Create admin - requires super-admin only
router.post("/register-admin", protect, superAdminOnly, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });
    const exists = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (exists) return res.status(400).json({ error: "Email already in use" });
    const user = await User.create({
      name,
      email: normalizeEmail(email),
      password,
      role: "admin",
      emailVerified: true,
    });
    res.status(201).json({ token: signToken(user), user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create super-admin — requires super-admin only
// Admin invitation verification and password setup
router.get("/admin-invite", async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email)
      return res.status(400).json({ error: "Invitation token is required" });

    const user = await User.findOne({
      where: { email: normalizeEmail(String(email)) },
    });

    if (!hasValidAdminInvite(user, token)) {
      return res.status(400).json({ error: "Invalid or expired invitation link" });
    }

    res.json({
      name: user.name,
      email: user.email,
      expiresAt: user.adminInviteExpires,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/admin-invite/accept", async (req, res) => {
  try {
    const { token, email, password } = req.body;
    if (!token || !email || !password)
      return res.status(400).json({ error: "Email, token, and password are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const user = await User.findOne({
      where: { email: normalizeEmail(email) },
    });

    if (!hasValidAdminInvite(user, token)) {
      return res.status(400).json({ error: "Invalid or expired invitation link" });
    }

    user.password = password;
    user.passwordSetupRequired = false;
    user.emailVerified = true;
    user.adminInviteToken = null;
    user.adminInviteExpires = null;
    await user.save();

    res.json({
      message: "Password created successfully.",
      token: signToken(user),
      user: userPayload(user),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/register-super-admin",
  protect,
  superAdminOnly,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password)
        return res.status(400).json({ error: "All fields are required" });
      const exists = await User.findOne({ where: { email: normalizeEmail(email) } });
      if (exists)
        return res.status(400).json({ error: "Email already in use" });
      const user = await User.create({
        name,
        email: normalizeEmail(email),
        password,
        role: "super-admin",
        emailVerified: true,
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
    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: "Invalid email or password" });
    if (user.isBlocked)
      return res.status(403).json({ error: "This account has been blocked." });
    if (user.role === "admin" && user.passwordSetupRequired)
      return res.status(403).json({
        error: "Please accept your admin invitation and create a password first.",
      });
    if (user.role === "user" && !user.emailVerified)
      return res.status(403).json({
        error: "Please verify your email before logging in.",
      });
    res.json({ token: signToken(user), user: userPayload(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (user) {
      const otp = String(crypto.randomInt(100000, 1000000));
      user.passwordResetOtp = hashValue(otp);
      user.passwordResetOtpExpires = tokenExpiry(10);
      await user.save();
      await sendPasswordResetEmail(user, otp);
    }

    res.json({ message: "If the email exists, a reset code has been sent." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password)
      return res.status(400).json({ error: "Email, OTP, and password are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (
      !user ||
      user.passwordResetOtp !== hashValue(String(otp)) ||
      !user.passwordResetOtpExpires ||
      user.passwordResetOtpExpires < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    user.password = password;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
    await user.save();

    res.json({ message: "Password reset successful. You can now log in." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
