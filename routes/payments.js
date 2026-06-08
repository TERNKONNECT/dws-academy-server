import express from "express";
import crypto from "crypto";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../config/paystack.js";
import {
  appUrl,
  paymentInvoiceEmailTemplate,
  sendEmail,
} from "../config/email.js";

const router = express.Router();

const toKobo = (amount) => Math.round(Number(amount || 0) * 100);
const frontendUrl = (path) =>
  `${(process.env.FRONTEND_URL || "http://localhost:8080").replace(/\/$/, "")}${path}`;

function makeReference(courseId, userId) {
  return `dws-${courseId.slice(0, 8)}-${userId.slice(0, 8)}-${Date.now()}`;
}

async function grantCourseAccess(payment, paystackData = {}) {
  if (!payment || payment.status === "success") return payment;

  const paidAt = paystackData.paid_at || paystackData.transaction_date || new Date();
  await payment.update({
    status: "success",
    paidAt,
    channel: paystackData.channel || payment.channel || "",
    gatewayResponse:
      paystackData.gateway_response || payment.gatewayResponse || "Successful",
    paystackTransactionId: paystackData.id ? String(paystackData.id) : "",
    metadata: paystackData,
  });

  await Enrollment.findOrCreate({
    where: { userId: payment.userId, courseId: payment.courseId },
    defaults: { userId: payment.userId, courseId: payment.courseId },
  });

  const [user, course] = await Promise.all([
    User.findByPk(payment.userId),
    Course.findByPk(payment.courseId),
  ]);

  if (user && course) {
    await sendEmail({
      to: user.email,
      subject: `Payment confirmed: ${course.title}`,
      html: paymentInvoiceEmailTemplate({
        name: user.name,
        courseTitle: course.title,
        amount: payment.amount,
        currency: payment.currency,
        reference: payment.reference,
        paidAt,
        courseLink: frontendUrl(`/learn/${course.id}`),
      }),
    });
  }

  return payment;
}

router.post("/initialize", protect, async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: "Course is required" });

    const [course, user] = await Promise.all([
      Course.findByPk(courseId),
      User.findByPk(req.user.id),
    ]);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (course.status !== "published")
      return res.status(400).json({ error: "Course is not available" });
    if (course.pricingType !== "paid" || Number(course.price) <= 0)
      return res.status(400).json({ error: "This course is free" });

    const existingEnrollment = await Enrollment.findOne({
      where: { userId: req.user.id, courseId },
    });
    if (existingEnrollment)
      return res.status(400).json({ error: "You already have access to this course" });

    const successfulPayment = await Payment.findOne({
      where: { userId: req.user.id, courseId, status: "success" },
    });
    if (successfulPayment)
      return res.status(400).json({ error: "Payment already completed" });

    const reference = makeReference(course.id, user.id);
    const callbackUrl = frontendUrl(`/payment/success?reference=${reference}`);
    const failedUrl = frontendUrl(`/payment/failed?reference=${reference}&courseId=${course.id}`);

    const initialized = await initializePaystackTransaction({
      email: user.email,
      amount: toKobo(course.price),
      currency: course.currency || "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        courseId: course.id,
        userId: user.id,
        courseTitle: course.title,
        failedUrl,
      },
    });

    const payment = await Payment.create({
      userId: user.id,
      courseId: course.id,
      reference,
      accessCode: initialized.access_code || "",
      authorizationUrl: initialized.authorization_url || "",
      amount: Number(course.price),
      currency: course.currency || "NGN",
      status: "pending",
      metadata: initialized,
    });

    res.status(201).json({
      reference,
      authorizationUrl: payment.authorizationUrl,
      accessCode: payment.accessCode,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/verify/:reference", protect, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      where: { reference: req.params.reference, userId: req.user.id },
      include: [{ model: Course }],
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const data = await verifyPaystackTransaction(payment.reference);
    if (data.status === "success") {
      await grantCourseAccess(payment, data);
      return res.json({
        status: "success",
        courseId: payment.courseId,
        courseTitle: payment.Course?.title,
      });
    }

    await payment.update({
      status: data.status === "abandoned" ? "abandoned" : "failed",
      gatewayResponse: data.gateway_response || data.status,
      metadata: data,
    });

    res.status(400).json({
      status: payment.status,
      error: data.gateway_response || "Payment was not successful",
      courseId: payment.courseId,
      courseTitle: payment.Course?.title,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const signature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "")
      .update(rawBody)
      .digest("hex");

    if (signature !== req.headers["x-paystack-signature"]) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = req.body;
    if (event?.event === "charge.success") {
      const data = event.data;
      const payment = await Payment.findOne({
        where: { reference: data.reference },
      });
      if (payment) {
        const verifiedData = await verifyPaystackTransaction(data.reference);
        if (verifiedData && verifiedData.status === "success") {
          await grantCourseAccess(payment, verifiedData);
        } else {
          await payment.update({
            status: verifiedData?.status === "abandoned" ? "abandoned" : "failed",
            gatewayResponse: verifiedData?.gateway_response || "Verification failed",
            metadata: verifiedData || {},
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Paystack webhook error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
