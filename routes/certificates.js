import express from "express";
import crypto from "crypto";
import Certificate from "../models/Certificate.js";
import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

function generateCertificateId() {
  return `DWS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// POST /api/certificates/issue — issue (or return the existing) certificate for a
// course the caller has completed. Idempotent: safe to call every time the
// certificate page loads.
router.post("/issue", protect, async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: "courseId is required" });

    const enrollment = await Enrollment.findOne({
      where: { userId: req.user.id, courseId },
    });
    if (!enrollment || !enrollment.isCompleted) {
      return res.status(403).json({ error: "Course must be completed before a certificate can be issued" });
    }

    const existing = await Certificate.findOne({ where: { userId: req.user.id, courseId } });
    if (existing) return res.json(existing);

    const [user, course] = await Promise.all([
      User.findByPk(req.user.id),
      Course.findByPk(courseId, { include: [{ model: User, as: "instructor", attributes: ["name"] }] }),
    ]);
    if (!course) return res.status(404).json({ error: "Course not found" });

    let certificateId = generateCertificateId();
    // Vanishingly unlikely to collide, but guard against it rather than trust it blindly.
    while (await Certificate.findOne({ where: { certificateId } })) {
      certificateId = generateCertificateId();
    }

    const certificate = await Certificate.create({
      certificateId,
      userId: user.id,
      courseId: course.id,
      studentName: user.name,
      courseName: course.title,
      instructorName: course.instructor?.name ?? null,
      issuedAt: enrollment.completedAt ?? new Date(),
    });

    res.status(201).json(certificate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/certificates/mine/:courseId — fetch the caller's own certificate for a course, if issued
router.get("/mine/:courseId", protect, async (req, res) => {
  try {
    const certificate = await Certificate.findOne({
      where: { userId: req.user.id, courseId: req.params.courseId },
    });
    if (!certificate) return res.status(404).json({ error: "Certificate not found" });
    res.json(certificate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/certificates/verify/:certificateId — PUBLIC, no auth. Lets anyone (e.g. an
// employer) confirm a certificate is genuine from the code printed on it.
router.get("/verify/:certificateId", async (req, res) => {
  try {
    const certificate = await Certificate.findOne({
      where: { certificateId: req.params.certificateId.toUpperCase() },
    });
    if (!certificate) {
      return res.status(404).json({ valid: false, error: "Certificate not found" });
    }
    res.json({
      valid: true,
      certificateId: certificate.certificateId,
      studentName: certificate.studentName,
      courseName: certificate.courseName,
      instructorName: certificate.instructorName,
      issuedAt: certificate.issuedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
