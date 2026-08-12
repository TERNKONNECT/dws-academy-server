import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Enrollment from "../models/Enrollment.js";
import {
  passwordResetEmailTemplate,
  sendEmail,
  verificationEmailTemplate,
} from "../config/email.js";
import { protect, superAdminOnly } from "../middleware/auth.js";
import {
  emailLimiter,
  loginLimiter,
  otpLimiter,
} from "../middleware/rateLimit.js";

const router = express.Router();

// One password policy, used by registration, reset, invite acceptance, and change.
// Previously registration had no rule at all, so a password accepted at signup could
// be rejected the first time the same person tried to change it.
const MIN_PASSWORD_LENGTH = 8;
const MAX_OTP_ATTEMPTS = 5;

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return "Password is too long";
  return null;
}

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

async function userPayload(user) {
  // These used to be hardcoded (`isBlocked: false`, empty arrays), which meant the
  // login response actively contradicted the database.
  const enrollments = await Enrollment.findAll({
    where: { userId: user.id },
    attributes: ["courseId"],
    raw: true,
  });

  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isBlocked: Boolean(user.isBlocked),
    emailVerified: Boolean(user.emailVerified),
    enrolledCourses: enrollments.map((e) => e.courseId),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const hashValue = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const normalizeEmail = (email) => String(email).toLowerCase().trim();
const tokenExpiry = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

/** Constant-time compare so a stored hash can't be probed by response timing. */
function hashMatches(stored, candidate) {
  if (!stored) return false;
  const a = Buffer.from(String(stored));
  const b = Buffer.from(hashValue(String(candidate)));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendVerificationEmail(user) {
  const otp = String(crypto.randomInt(100000, 1000000));
  user.emailVerificationToken = hashValue(otp);
  user.emailVerificationExpires = tokenExpiry(15);
  user.otpAttempts = 0;
  await user.save();

  const emailResult = await sendEmail({
    to: user.email,
    subject: "Verify your DWS Academy account",
    html: verificationEmailTemplate({ name: user.name, otp }),
  });

  if (emailResult?.skipped) {
    console.warn(`Verification code for ${user.email}: ${otp}`);
  }

  return { otp, skipped: Boolean(emailResult?.skipped) };
}

async function sendPasswordResetEmail(user, otp) {
  await sendEmail({
    to: user.email,
    subject: "Your DWS Academy password reset code",
    html: passwordResetEmailTemplate({ name: user.name, otp }),
  });
}

/**
 * Records a wrong code and reports whether the account is now locked out.
 * IP rate limiting is per-instance on serverless; this counter is not.
 */
async function registerOtpFailure(user) {
  user.otpAttempts = (user.otpAttempts || 0) + 1;
  if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
    // Burn the code rather than the account — the person can request a new one.
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
  }
  await user.save();
  return user.otpAttempts >= MAX_OTP_ATTEMPTS;
}

function hasValidAdminInvite(user, token) {
  return (
    user &&
    (user.role === "admin" || user.role === "operator") &&
    user.passwordSetupRequired &&
    hashMatches(user.adminInviteToken, token) &&
    user.adminInviteExpires &&
    user.adminInviteExpires > new Date()
  );
}

// Public user registration
router.post("/register", emailLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });

    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const normalizedEmail = normalizeEmail(email);
    const exists = await User.findOne({ where: { email: normalizedEmail } });

    if (exists) {
      // An unverified account gets a fresh code, but nothing about it changes.
      // Overwriting the stored password here let anyone reset a pending signup
      // just by re-submitting its email address.
      if (exists.role === "user" && !exists.emailVerified) {
        const verification = await sendVerificationEmail(exists);
        return res.status(200).json({
          message: verification.skipped
            ? "Verification email could not be sent in Resend testing mode. Use the verification code from the server logs."
            : "Verification code resent. Check your inbox.",
          verificationOtp:
            verification.skipped && process.env.NODE_ENV !== "production"
              ? verification.otp
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
        ? "Account created. Verification email could not be sent in Resend testing mode. Use the verification code from the server logs."
        : "Account created. Check your email for a verification code.",
      verificationOtp:
        verification.skipped && process.env.NODE_ENV !== "production"
          ? verification.otp
          : undefined,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/verify-email", otpLimiter, async (req, res, next) => {
  try {
    const { otp, email } = req.body;
    if (!otp || !email)
      return res.status(400).json({ error: "Verification code is required" });

    const user = await User.findOne({
      where: { email: normalizeEmail(email) },
    });

    const invalid = { error: "Invalid or expired verification code" };
    if (!user) return res.status(400).json(invalid);

    if (
      !hashMatches(user.emailVerificationToken, otp) ||
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      const lockedOut = await registerOtpFailure(user);
      return res.status(400).json(
        lockedOut
          ? { error: "Too many incorrect codes. Request a new one." }
          : invalid,
      );
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.otpAttempts = 0;
    await user.save();

    res.json({ message: "Email verified. You can now log in." });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification — manually request a fresh verification code.
router.post("/resend-verification", emailLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({
      where: { email: normalizeEmail(email) },
    });
    if (user && !user.emailVerified) {
      await sendVerificationEmail(user);
    }

    // Same response whether or not the account exists, so this can't be used to
    // probe which emails are registered.
    res.json({
      message:
        "If an account with that email exists and isn't verified yet, a new verification code has been sent.",
    });
  } catch (err) {
    next(err);
  }
});

// Create admin — super-admin only
router.post("/register-admin", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required" });

    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const exists = await User.findOne({
      where: { email: normalizeEmail(email) },
    });
    if (exists) return res.status(400).json({ error: "Email already in use" });

    const user = await User.create({
      name,
      email: normalizeEmail(email),
      password,
      role: "admin",
      emailVerified: true,
    });
    res.status(201).json({ token: signToken(user), user: await userPayload(user) });
  } catch (err) {
    next(err);
  }
});

// Admin invitation verification and password setup
router.get("/admin-invite", async (req, res, next) => {
  try {
    const { token, email } = req.query;
    if (!token || !email)
      return res.status(400).json({ error: "Invitation token is required" });

    const user = await User.findOne({
      where: { email: normalizeEmail(email) },
    });

    if (!hasValidAdminInvite(user, token)) {
      return res
        .status(400)
        .json({ error: "Invalid or expired invitation link" });
    }

    res.json({
      name: user.name,
      email: user.email,
      expiresAt: user.adminInviteExpires,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin-invite/accept", otpLimiter, async (req, res, next) => {
  try {
    const { token, email, password } = req.body;
    if (!token || !email || !password)
      return res
        .status(400)
        .json({ error: "Email, token, and password are required" });

    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const user = await User.findOne({
      where: { email: normalizeEmail(email) },
    });

    if (!hasValidAdminInvite(user, token)) {
      return res
        .status(400)
        .json({ error: "Invalid or expired invitation link" });
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
      user: await userPayload(user),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/register-super-admin",
  protect,
  superAdminOnly,
  async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password)
        return res.status(400).json({ error: "All fields are required" });

      const problem = passwordProblem(password);
      if (problem) return res.status(400).json({ error: problem });

      const exists = await User.findOne({
        where: { email: normalizeEmail(email) },
      });
      if (exists) return res.status(400).json({ error: "Email already in use" });

      const user = await User.create({
        name,
        email: normalizeEmail(email),
        password,
        role: "super-admin",
        emailVerified: true,
      });
      res
        .status(201)
        .json({ token: signToken(user), user: await userPayload(user) });
    } catch (err) {
      next(err);
    }
  },
);

// Login — all roles
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });

    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: "Invalid email or password" });

    // Blocking a user used to be inert: the flag was written by the admin UI and
    // read by nothing. It is enforced here and in `protect`.
    if (user.isBlocked)
      return res.status(403).json({
        error: "This account has been blocked. Contact support.",
      });
    if (user.deactivatedAt)
      return res.status(403).json({
        error:
          "This account has been deactivated. Contact support to reactivate.",
      });
    if (user.passwordSetupRequired)
      return res.status(403).json({
        error: "Please accept your invitation and create a password first.",
      });
    if (user.role === "user" && !user.emailVerified)
      return res.status(403).json({
        error: "Please verify your email before logging in.",
        code: "EMAIL_NOT_VERIFIED",
      });

    res.json({ token: signToken(user), user: await userPayload(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/forgot-password", emailLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    if (user && !user.isBlocked && !user.deactivatedAt) {
      const otp = String(crypto.randomInt(100000, 1000000));
      user.passwordResetOtp = hashValue(otp);
      user.passwordResetOtpExpires = tokenExpiry(10);
      user.otpAttempts = 0;
      await user.save();
      await sendPasswordResetEmail(user, otp);
    }

    res.json({ message: "If the email exists, a reset code has been sent." });
  } catch (err) {
    next(err);
  }
});

router.post("/reset-password", otpLimiter, async (req, res, next) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password)
      return res
        .status(400)
        .json({ error: "Email, OTP, and password are required" });

    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const user = await User.findOne({ where: { email: normalizeEmail(email) } });
    const invalid = { error: "Invalid or expired reset code" };
    if (!user) return res.status(400).json(invalid);

    if (
      !hashMatches(user.passwordResetOtp, otp) ||
      !user.passwordResetOtpExpires ||
      user.passwordResetOtpExpires < new Date()
    ) {
      const lockedOut = await registerOtpFailure(user);
      return res.status(400).json(
        lockedOut
          ? { error: "Too many incorrect codes. Request a new one." }
          : invalid,
      );
    }

    user.password = password;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpires = null;
    user.otpAttempts = 0;
    await user.save();

    res.json({ message: "Password reset successful. You can now log in." });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/password — change password for the logged-in user
router.put("/password", protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current and new password are required" });
    }

    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ error: "Incorrect current password" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/deactivate — self-service account deactivation
router.post("/deactivate", protect, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    user.deactivatedAt = new Date();
    await user.save();

    // `protect` re-reads the user on every request, so the current token stops
    // working immediately rather than at its 7-day expiry.
    res.json({ message: "Account deactivated." });
  } catch (err) {
    next(err);
  }
});

export default router;
