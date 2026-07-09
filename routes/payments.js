import express from "express";
import crypto from "crypto";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import { protect, adminOnly } from "../middleware/auth.js";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../config/paystack.js";
import {
  paymentInvoiceEmailTemplate,
  sendEmail,
} from "../config/email.js";

const router = express.Router();

const finalFailureStatuses = new Set(["abandoned", "failed", "reversed"]);
const toKobo = (amount) => Math.round(Number(amount || 0) * 100);
const frontendUrl = (path) =>
  `${(process.env.FRONTEND_URL || "http://localhost:8080").replace(/\/$/, "")}${path}`;

function paymentLog(level, event, details = {}) {
  const logger = console[level] || console.info;
  logger(
    JSON.stringify({
      scope: "payments",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function errorDetails(err) {
  return {
    error: err?.message || String(err),
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
  };
}

function makeReference(courseId, userId) {
  return `dws-${courseId.slice(0, 8)}-${userId.slice(0, 8)}-${Date.now()}`;
}

function safeEqual(a = "", b = "") {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function validatePaystackConfirmation(payment, paystackData = {}) {
  paymentLog("info", "confirmation_validation_started", {
    reference: payment?.reference,
    paymentId: payment?.id,
    paystackStatus: paystackData.status,
    expectedAmountKobo: payment ? toKobo(payment.amount) : undefined,
    paidAmountKobo: paystackData.amount,
    expectedCurrency: payment?.currency,
    paidCurrency: paystackData.currency,
  });

  if (paystackData.status !== "success") {
    throw new Error("Paystack has not confirmed a successful payment");
  }
  if (paystackData.reference !== payment.reference) {
    throw new Error("Payment reference mismatch");
  }
  const paidAmountKobo = Number(paystackData.amount);
  const expectedAmountKobo = toKobo(payment.amount);
  if (paidAmountKobo < expectedAmountKobo) {
    throw new Error(
      `Payment amount too low: paid ${paidAmountKobo} kobo, expected at least ${expectedAmountKobo} kobo`
    );
  }
  if (paidAmountKobo > expectedAmountKobo) {
    // Paystack transaction fees borne by the customer cause the paid amount
    // to exceed the base price – this is expected on live keys.
    paymentLog("info", "confirmation_fee_detected", {
      reference: payment.reference,
      paymentId: payment.id,
      expectedAmountKobo,
      paidAmountKobo,
      feeDifferenceKobo: paidAmountKobo - expectedAmountKobo,
    });
  }
  if (
    String(paystackData.currency || "").toUpperCase() !==
    String(payment.currency || "NGN").toUpperCase()
  ) {
    throw new Error("Payment currency mismatch");
  }

  const metadata = paystackData.metadata || {};
  if (metadata.courseId && metadata.courseId !== payment.courseId) {
    throw new Error("Payment course mismatch");
  }
  if (metadata.userId && metadata.userId !== payment.userId) {
    throw new Error("Payment user mismatch");
  }

  paymentLog("info", "confirmation_validation_passed", {
    reference: payment.reference,
    paymentId: payment.id,
  });
}

async function grantCourseAccess(payment, paystackData = {}) {
  if (!payment) {
    paymentLog("warn", "access_grant_skipped_missing_payment");
    return payment;
  }
  if (payment.status === "success") {
    paymentLog("info", "access_grant_skipped_already_successful", {
      reference: payment.reference,
      paymentId: payment.id,
      userId: payment.userId,
      courseId: payment.courseId,
    });
    return payment;
  }

  paymentLog("info", "access_grant_started", {
    reference: payment.reference,
    paymentId: payment.id,
    userId: payment.userId,
    courseId: payment.courseId,
    amount: payment.amount,
    currency: payment.currency,
    paystackTransactionId: paystackData.id ? String(paystackData.id) : "",
  });

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

  const [_enrollment, enrollmentCreated] = await Enrollment.findOrCreate({
    where: { userId: payment.userId, courseId: payment.courseId },
    defaults: { userId: payment.userId, courseId: payment.courseId },
  });

  paymentLog("info", "access_grant_enrollment_ready", {
    reference: payment.reference,
    paymentId: payment.id,
    userId: payment.userId,
    courseId: payment.courseId,
    enrollmentCreated,
  });

  const [user, course] = await Promise.all([
    User.findByPk(payment.userId),
    Course.findByPk(payment.courseId),
  ]);

  if (user && course) {
    try {
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
      paymentLog("info", "payment_receipt_email_sent", {
        reference: payment.reference,
        paymentId: payment.id,
        userId: payment.userId,
        courseId: payment.courseId,
        email: user.email,
      });
    } catch (err) {
      paymentLog("error", "payment_receipt_email_failed", {
        reference: payment.reference,
        paymentId: payment.id,
        userId: payment.userId,
        courseId: payment.courseId,
        email: user.email,
        ...errorDetails(err),
      });
    }
  }

  paymentLog("info", "access_grant_completed", {
    reference: payment.reference,
    paymentId: payment.id,
    userId: payment.userId,
    courseId: payment.courseId,
    paidAt,
  });

  return payment;
}

async function confirmAndGrantCourseAccess(payment, paystackData = {}) {
  try {
    validatePaystackConfirmation(payment, paystackData);
    return grantCourseAccess(payment, paystackData);
  } catch (err) {
    paymentLog("error", "confirmation_validation_failed", {
      reference: payment?.reference,
      paymentId: payment?.id,
      paystackStatus: paystackData?.status,
      ...errorDetails(err),
    });
    throw err;
  }
}

router.get("/config", (req, res) => {
  res.json({
    serviceFeePercentage: Number(process.env.SERVICE_FEE_PERCENTAGE || 0)
  });
});

router.post("/initialize", protect, async (req, res) => {
  try {
    const { courseId } = req.body;
    paymentLog("info", "initialize_called", {
      userId: req.user?.id,
      courseId,
      ip: req.ip,
    });

    if (!courseId) {
      paymentLog("warn", "initialize_rejected_missing_course", {
        userId: req.user?.id,
      });
      return res.status(400).json({ error: "Course is required" });
    }

    const [course, user] = await Promise.all([
      Course.findByPk(courseId),
      User.findByPk(req.user.id),
    ]);
    if (!course) {
      paymentLog("warn", "initialize_rejected_course_not_found", {
        userId: req.user.id,
        courseId,
      });
      return res.status(404).json({ error: "Course not found" });
    }
    if (!user) {
      paymentLog("warn", "initialize_rejected_user_not_found", {
        userId: req.user.id,
        courseId,
      });
      return res.status(404).json({ error: "User not found" });
    }
    if (course.status !== "published") {
      paymentLog("warn", "initialize_rejected_unpublished_course", {
        userId: req.user.id,
        courseId,
        courseStatus: course.status,
      });
      return res.status(400).json({ error: "Course is not available" });
    }
    if (course.pricingType !== "paid" || Number(course.price) <= 0) {
      paymentLog("warn", "initialize_rejected_free_course", {
        userId: req.user.id,
        courseId,
        pricingType: course.pricingType,
        price: course.price,
      });
      return res.status(400).json({ error: "This course is free" });
    }

    const existingEnrollment = await Enrollment.findOne({
      where: { userId: req.user.id, courseId },
    });
    if (existingEnrollment) {
      paymentLog("warn", "initialize_rejected_already_enrolled", {
        userId: req.user.id,
        courseId,
        enrollmentId: existingEnrollment.id,
      });
      return res.status(400).json({ error: "You already have access to this course" });
    }

    const successfulPayment = await Payment.findOne({
      where: { userId: req.user.id, courseId, status: "success" },
    });
    if (successfulPayment) {
      paymentLog("warn", "initialize_rejected_payment_already_successful", {
        userId: req.user.id,
        courseId,
        paymentId: successfulPayment.id,
        reference: successfulPayment.reference,
      });
      return res.status(400).json({ error: "Payment already completed" });
    }

    const reference = makeReference(course.id, user.id);
    const callbackUrl = frontendUrl(`/payment/success?reference=${reference}`);
    const failedUrl = frontendUrl(`/payment/failed?reference=${reference}&courseId=${course.id}`);
    
    const serviceFeePercentage = Number(process.env.SERVICE_FEE_PERCENTAGE || 0);
    const courseFee = Number(course.price);
    const expectedServiceFee = courseFee * (serviceFeePercentage / 100);
    const expectedTotalAmount = courseFee + expectedServiceFee;
    
    const finalTotalAmount = expectedTotalAmount;
    
    const amountKobo = toKobo(finalTotalAmount);

    paymentLog("info", "paystack_initialize_requested", {
      userId: user.id,
      courseId: course.id,
      reference,
      amount: finalTotalAmount,
      courseFee: courseFee,
      serviceFee: expectedServiceFee,
      amountKobo,
      currency: course.currency || "NGN",
    });

    const initialized = await initializePaystackTransaction({
      email: user.email,
      amount: amountKobo,
      currency: course.currency || "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        courseId: course.id,
        userId: user.id,
        courseTitle: course.title,
        failedUrl,
      },
      ...(process.env.PAYSTACK_SUBACCOUNT ? { subaccount: process.env.PAYSTACK_SUBACCOUNT } : {})
    });

    paymentLog("info", "paystack_initialize_succeeded", {
      userId: user.id,
      courseId: course.id,
      reference,
      paystackReference: initialized.reference,
      hasAuthorizationUrl: Boolean(initialized.authorization_url),
    });

    const payment = await Payment.create({
      userId: user.id,
      courseId: course.id,
      reference,
      accessCode: initialized.access_code || "",
      authorizationUrl: initialized.authorization_url || "",
      amount: finalTotalAmount,
      currency: course.currency || "NGN",
      status: "pending",
      metadata: initialized,
    });

    paymentLog("info", "payment_record_created", {
      paymentId: payment.id,
      userId: user.id,
      courseId: course.id,
      reference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    });

    res.status(201).json({
      reference,
      authorizationUrl: payment.authorizationUrl,
      accessCode: payment.accessCode,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (err) {
    paymentLog("error", "initialize_failed", {
      userId: req.user?.id,
      courseId: req.body?.courseId,
      ...errorDetails(err),
    });
    res.status(500).json({ error: err.message });
  }
});

// Calls Paystack to check a payment's real status, grants course access if it
// has actually succeeded, and otherwise brings our local status in sync.
// Shared by the student-facing verify route and the admin re-verify route,
// since both are just "ask Paystack again" for a payment that's stuck.
async function runPaymentVerification(payment, { actorId } = {}) {
  paymentLog("info", "paystack_verify_requested", {
    actorId,
    paymentId: payment.id,
    courseId: payment.courseId,
    reference: payment.reference,
    currentStatus: payment.status,
  });

  const data = await verifyPaystackTransaction(payment.reference);
  paymentLog("info", "paystack_verify_succeeded", {
    actorId,
    paymentId: payment.id,
    courseId: payment.courseId,
    reference: payment.reference,
    paystackStatus: data.status,
    amountKobo: data.amount,
    currency: data.currency,
    gatewayResponse: data.gateway_response,
  });

  if (data.status === "success") {
    await confirmAndGrantCourseAccess(payment, data);
    paymentLog("info", "verify_success_access_granted", {
      actorId,
      paymentId: payment.id,
      courseId: payment.courseId,
      reference: payment.reference,
    });
    return {
      httpStatus: 200,
      body: {
        status: "success",
        courseId: payment.courseId,
        courseTitle: payment.Course?.title,
      },
    };
  }

  const status = finalFailureStatuses.has(data.status) ? "failed" : "pending";
  await payment.update({
    status: data.status === "abandoned" ? "abandoned" : status,
    gatewayResponse: data.gateway_response || data.status,
    metadata: data,
  });

  const stillProcessing = status === "pending";
  paymentLog("info", "verify_completed_without_access", {
    actorId,
    paymentId: payment.id,
    courseId: payment.courseId,
    reference: payment.reference,
    paystackStatus: data.status,
    storedStatus: payment.status,
    stillProcessing,
    accessGranted: false,
  });

  return {
    httpStatus: stillProcessing ? 202 : 400,
    body: {
      status: payment.status,
      error: stillProcessing
        ? "Payment is still processing. Access will be granted after Paystack confirms the payment."
        : data.gateway_response || "Payment was not successful",
      courseId: payment.courseId,
      courseTitle: payment.Course?.title,
    },
  };
}

router.get("/verify/:reference", protect, async (req, res) => {
  try {
    paymentLog("info", "verify_called", {
      userId: req.user?.id,
      reference: req.params.reference,
      ip: req.ip,
    });

    const payment = await Payment.findOne({
      where: { reference: req.params.reference },
      include: [{ model: Course }],
    });
    if (!payment) {
      paymentLog("warn", "verify_rejected_payment_not_found", {
        userId: req.user.id,
        reference: req.params.reference,
      });
      return res.status(404).json({ error: "Payment not found" });
    }
    
    if (payment.userId !== req.user.id) {
      paymentLog("warn", "verify_rejected_user_mismatch", {
        requestUserId: req.user.id,
        paymentUserId: payment.userId,
        reference: req.params.reference,
      });
      return res.status(403).json({ error: "Payment belongs to a different user" });
    }

    const result = await runPaymentVerification(payment, { actorId: req.user.id });
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    paymentLog("error", "verify_failed", {
      userId: req.user?.id,
      reference: req.params.reference,
      ...errorDetails(err),
    });
    res.status(500).json({ error: err.message });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
// Instructor admins are scoped to courses they created; super-admin/operator see everything.

// GET /api/payments/admin/courses/:courseId/pending — payments stuck pending for a course
// (i.e. Paystack was never confirmed — usually a missed/failed webhook)
router.get("/admin/courses/:courseId/pending", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (req.user.role !== "super-admin" && course.createdBy !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to view payments for this course" });
    }

    const payments = await Payment.findAll({
      where: { courseId: req.params.courseId, status: "pending" },
      include: [{ model: User, attributes: ["id", "name", "email"] }],
      order: [["createdAt", "DESC"]],
    });

    res.json(
      payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        amount: p.amount,
        currency: p.currency,
        createdAt: p.createdAt,
        user: p.User,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/admin/verify/:reference — admin re-verifies any user's stuck payment
router.post("/admin/verify/:reference", protect, adminOnly, async (req, res) => {
  try {
    paymentLog("info", "admin_verify_called", {
      adminId: req.user?.id,
      reference: req.params.reference,
    });

    const payment = await Payment.findOne({
      where: { reference: req.params.reference },
      include: [{ model: Course }],
    });
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }
    if (req.user.role !== "super-admin" && payment.Course?.createdBy !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to verify this payment" });
    }

    const result = await runPaymentVerification(payment, { actorId: req.user.id });
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    paymentLog("error", "admin_verify_failed", {
      adminId: req.user?.id,
      reference: req.params.reference,
      ...errorDetails(err),
    });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/admin/verify-bulk — re-verify a batch of stuck pending payments at once.
// Capped per call so a single request can't run indefinitely on serverless; call again
// (the response reports `remaining`) to keep working through a large backlog.
const BULK_VERIFY_BATCH_LIMIT = 20;

router.post("/admin/verify-bulk", protect, adminOnly, async (req, res) => {
  try {
    const { courseId } = req.body || {};
    const scoped = req.user.role !== "super-admin";

    const where = { status: "pending" };
    if (scoped) {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      const ownCourseIds = courses.map((c) => c.id);
      if (courseId && !ownCourseIds.includes(courseId)) {
        return res.status(403).json({ error: "Not authorized to verify payments for this course" });
      }
      where.courseId = courseId || (ownCourseIds.length ? ownCourseIds : ["__none__"]);
    } else if (courseId) {
      where.courseId = courseId;
    }

    const totalPending = await Payment.count({ where });
    const batch = await Payment.findAll({
      where,
      include: [{ model: Course }],
      order: [["createdAt", "ASC"]],
      limit: BULK_VERIFY_BATCH_LIMIT,
    });

    paymentLog("info", "bulk_verify_started", {
      adminId: req.user.id,
      courseId: courseId || null,
      batchSize: batch.length,
      totalPending,
    });

    const results = [];
    for (const payment of batch) {
      try {
        const result = await runPaymentVerification(payment, { actorId: req.user.id });
        results.push({
          reference: payment.reference,
          status: result.body.status,
          courseTitle: payment.Course?.title,
        });
      } catch (err) {
        results.push({
          reference: payment.reference,
          status: "error",
          error: err.message,
          courseTitle: payment.Course?.title,
        });
      }
    }

    const summary = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    paymentLog("info", "bulk_verify_completed", {
      adminId: req.user.id,
      processed: results.length,
      remaining: Math.max(0, totalPending - results.length),
      summary,
    });

    res.json({
      processed: results.length,
      remaining: Math.max(0, totalPending - results.length),
      summary,
      results,
    });
  } catch (err) {
    paymentLog("error", "bulk_verify_failed", {
      adminId: req.user?.id,
      ...errorDetails(err),
    });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/admin/all — payment ledger with filters (status, courseId) + pagination
router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const { status, courseId, page = 1, limit = 20 } = req.query;
    const scoped = req.user.role !== "super-admin";

    const where = {};
    if (status) where.status = status;
    if (courseId) where.courseId = courseId;

    if (scoped) {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      const ownCourseIds = courses.map((c) => c.id);
      if (courseId && !ownCourseIds.includes(courseId)) {
        return res.status(403).json({ error: "Not authorized to view payments for this course" });
      }
      if (!courseId) where.courseId = ownCourseIds.length ? ownCourseIds : ["__none__"];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { rows, count } = await Payment.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ["id", "name", "email"] },
        { model: Course, attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        reference: p.reference,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        channel: p.channel,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        user: p.User,
        course: p.Course,
      })),
      total: count,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/admin/revenue — total/current-month revenue + last-12-months series
router.get("/admin/revenue", protect, adminOnly, async (req, res) => {
  try {
    const scoped = req.user.role !== "super-admin";
    let courseIds = null;
    if (scoped) {
      const courses = await Course.findAll({
        where: { createdBy: req.user.id },
        attributes: ["id"],
      });
      courseIds = courses.map((c) => c.id);
    }

    const scopeWhere = scoped ? { courseId: courseIds.length ? courseIds : ["__none__"] } : {};
    const successWhere = { ...scopeWhere, status: "success" };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [totalRevenue, currentMonthRevenue, monthlyRows, statusRows] = await Promise.all([
      Payment.sum("amount", { where: successWhere }),
      Payment.sum("amount", {
        where: { ...successWhere, paidAt: { [Op.gte]: startOfMonth } },
      }),
      Payment.findAll({
        where: { ...successWhere, paidAt: { [Op.gte]: twelveMonthsAgo } },
        attributes: [
          [sequelize.fn("to_char", sequelize.col("paidAt"), "YYYY-MM"), "month"],
          [sequelize.fn("SUM", sequelize.col("amount")), "revenue"],
        ],
        group: ["month"],
        raw: true,
      }),
      Payment.findAll({
        where: scopeWhere,
        attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
        group: ["status"],
        raw: true,
      }),
    ]);

    const monthMap = new Map(monthlyRows.map((r) => [r.month, Number(r.revenue)]));
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthly.push({
        month: key,
        label: d.toLocaleString("en-US", { month: "short", year: "numeric" }),
        revenue: monthMap.get(key) || 0,
      });
    }

    const statusBreakdown = { pending: 0, success: 0, failed: 0, abandoned: 0 };
    statusRows.forEach((r) => {
      statusBreakdown[r.status] = Number(r.count);
    });

    res.json({
      totalRevenue: Number(totalRevenue) || 0,
      currentMonthRevenue: Number(currentMonthRevenue) || 0,
      monthly,
      statusBreakdown,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    paymentLog("info", "webhook_received", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
      hasSignature: Boolean(req.headers["x-paystack-signature"]),
      rawBodyBytes: req.rawBody?.length,
      ip: req.ip,
    });

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "")
      .update(rawBody)
      .digest("hex");
    const signature = req.headers["x-paystack-signature"] || "";

    if (!process.env.PAYSTACK_SECRET_KEY || !safeEqual(expectedSignature, signature)) {
      paymentLog("warn", "webhook_rejected_invalid_signature", {
        event: req.body?.event,
        reference: req.body?.data?.reference,
        hasSecret: Boolean(process.env.PAYSTACK_SECRET_KEY),
        hasSignature: Boolean(signature),
      });
      return res.status(401).json({ error: "Invalid signature" });
    }

    paymentLog("info", "webhook_signature_verified", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
    });

    const event = req.body;
    if (event?.event === "charge.success") {
      paymentLog("info", "webhook_charge_success_received", {
        reference: event.data?.reference,
        eventId: event.data?.id,
      });

      const data = await verifyPaystackTransaction(event.data.reference);
      paymentLog("info", "webhook_paystack_verify_succeeded", {
        reference: data.reference,
        paystackStatus: data.status,
        amountKobo: data.amount,
        currency: data.currency,
        gatewayResponse: data.gateway_response,
      });

      const payment = await Payment.findOne({
        where: { reference: data.reference },
      });
      if (payment) {
        await confirmAndGrantCourseAccess(payment, data);
        paymentLog("info", "webhook_success_access_granted", {
          paymentId: payment.id,
          userId: payment.userId,
          courseId: payment.courseId,
          reference: payment.reference,
        });
      } else {
        paymentLog("warn", "webhook_payment_not_found", {
          reference: data.reference,
          paystackStatus: data.status,
        });
      }
    } else {
      paymentLog("info", "webhook_event_ignored", {
        event: event?.event,
        reference: event?.data?.reference,
      });
    }

    paymentLog("info", "webhook_completed", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
    });
    res.sendStatus(200);
  } catch (err) {
    paymentLog("error", "webhook_failed", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
      ...errorDetails(err),
    });
    res.status(500).json({ error: err.message });
  }
});

export default router;
