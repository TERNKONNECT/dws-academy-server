import express from "express";
import BookPreorder from "../models/BookPreorder.js";
import { protect, adminOnly } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../config/paystack.js";
import { sendEmail, bookPreorderConfirmationEmailTemplate } from "../config/email.js";

const router = express.Router();

const PRICE_PER_COPY_NGN = 15000;
const COMMUNITY_URL = "https://www.instagram.com/channel/AbZw-Yo56-tG_h53/";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const preorderLimiter = rateLimit({
  name: "book-preorder-initialize",
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: "Too many attempts. Wait a few minutes and try again.",
});

const frontendUrl = (path) =>
  `${(process.env.FRONTEND_URL || "http://localhost:8080").replace(/\/$/, "")}${path}`;

const makeReference = () =>
  `motd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const serialize = (p) => ({
  bookTitle: p.bookTitle,
  fullName: p.fullName,
  email: p.email,
  quantity: p.quantity,
  amount: p.amount,
  currency: p.currency,
  reference: p.reference,
  status: p.status,
});

function preorderLog(level, event, details = {}) {
  const logger = console[level] || console.info;
  logger(
    JSON.stringify({
      scope: "book-preorders",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

// Shared by the redirect-based verify route and the Paystack webhook (see
// routes/payments.js — Paystack only allows one webhook URL per account, so
// the existing /api/payments/webhook is the one actually registered with
// Paystack, and it dispatches here for anything with a "motd-" reference).
// Applies whatever Paystack says the real status is, and — since this is the
// only place either path marks a preorder "success" — fires the confirmation
// email exactly once, on the transition into that status.
export async function applyPreorderPaystackResult(preorder, data) {
  const wasAlreadySuccess = preorder.status === "success";

  if (data.status === "success") {
    await preorder.update({
      status: "success",
      paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
      channel: data.channel || "",
      gatewayResponse: data.gateway_response || "",
      paystackTransactionId: String(data.id || ""),
    });

    if (!wasAlreadySuccess) {
      try {
        await sendEmail({
          to: preorder.email,
          subject: `You're on the list — ${preorder.bookTitle}`,
          html: bookPreorderConfirmationEmailTemplate({
            fullName: preorder.fullName,
            bookTitle: preorder.bookTitle,
            quantity: preorder.quantity,
            amount: preorder.amount,
            currency: preorder.currency,
            reference: preorder.reference,
            communityUrl: COMMUNITY_URL,
          }),
        });
      } catch (err) {
        // A failed confirmation email must never fail the payment confirmation itself.
        preorderLog("error", "confirmation_email_failed", {
          reference: preorder.reference,
          error: err?.message || String(err),
        });
      }
    }
  } else {
    await preorder.update({
      status: data.status === "abandoned" ? "abandoned" : "failed",
      gatewayResponse: data.gateway_response || "",
    });
  }

  return preorder;
}

// Public: start a preorder — collects the buyer's details and hands back a
// Paystack checkout URL to redirect to.
router.post("/initialize", preorderLimiter, async (req, res, next) => {
  try {
    const { fullName, email, whatsapp, quantity, deliveryDetails } = req.body;

    if (!fullName || !email || !whatsapp) {
      return res.status(400).json({ error: "Name, email and WhatsApp number are required" });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const amount = PRICE_PER_COPY_NGN * qty;
    const reference = makeReference();
    const callbackUrl = frontendUrl(
      `/books/money-on-the-table/preorder/success?reference=${reference}`,
    );

    const initialized = await initializePaystackTransaction({
      email,
      amount: amount * 100,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        fullName,
        whatsapp,
        quantity: qty,
        book: "Money on the Table",
      },
    });

    await BookPreorder.create({
      bookSlug: "money-on-the-table",
      bookTitle: "Money on the Table",
      fullName,
      email,
      whatsapp,
      quantity: qty,
      deliveryDetails: deliveryDetails || "",
      reference,
      amount,
      currency: "NGN",
      status: "pending",
      metadata: initialized,
    });

    res.status(201).json({
      reference,
      authorizationUrl: initialized.authorization_url,
      amount,
      currency: "NGN",
    });
  } catch (err) {
    next(err);
  }
});

// Public: confirm a preorder after the buyer returns from Paystack. The
// webhook below is the source of truth for payment status — this route just
// asks Paystack directly too, so the confirmation page doesn't have to sit
// around waiting on webhook delivery.
router.get("/verify/:reference", async (req, res, next) => {
  try {
    const preorder = await BookPreorder.findOne({
      where: { reference: req.params.reference },
    });
    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }

    if (preorder.status !== "success") {
      const data = await verifyPaystackTransaction(req.params.reference);
      await applyPreorderPaystackResult(preorder, data);
    }

    res.json({ status: preorder.status, preorder: serialize(preorder) });
  } catch (err) {
    next(err);
  }
});

// SuperAdmin/Admin: list preorders for fulfillment. Book title is stored on
// each row, so this stays correct even once more books are added.
router.get("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const preorders = await BookPreorder.findAll({ order: [["createdAt", "DESC"]] });
    res.json(preorders);
  } catch (err) {
    next(err);
  }
});

router.delete("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const preorder = await BookPreorder.findByPk(req.params.id);
    if (!preorder) {
      return res.status(404).json({ error: "Preorder not found" });
    }
    if (preorder.status !== "pending") {
      return res.status(400).json({ error: "Only pending preorders can be deleted" });
    }
    await preorder.destroy();
    res.json({ message: "Preorder deleted successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
