import express from "express";
import { sendEmail } from "../config/email.js";

const router = express.Router();

const CONTACT_FROM =
  process.env.CONTACT_EMAIL_FROM || "School of Events Africa <noreply@schoolofeventsafrica.com>";

router.post("/", async (req, res, next) => {
  try {
    const { firstName, lastName, phone, email, category, message } = req.body;

    if (!firstName || !email || !category || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY is not configured.");
      return res.status(500).json({ error: "Email service is not configured" });
    }

    // 1. Send email to admin (School of Events Africa)
    try {
      await sendEmail({
        from: CONTACT_FROM,
        to: "schoolofeventsafrica@gmail.com",
        subject: `New Contact Form Submission: ${category}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName || ''}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || "N/A"}</p>
          <p><strong>Category:</strong> ${category}</p>
          <h3>Message:</h3>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `,
      });
    } catch (adminError) {
      console.error("Resend Error (Admin):", adminError);
      return res.status(400).json({ error: adminError.message });
    }

    // 2. Send confirmation email to the user
    try {
      await sendEmail({
        from: CONTACT_FROM,
        to: email,
        subject: "We have received your request - School of Events Africa",
        html: `
          <h2>Hi ${firstName},</h2>
          <p>Thank you for getting in touch with us at School of Events Africa!</p>
          <p>This is to confirm that we have received your request regarding <strong>${category}</strong>.</p>
          <p>Our team will review your message and get back to you within 24 hours.</p>
          <br/>
          <p>Best Regards,</p>
          <p>The School of Events Africa Team</p>
        `,
      });
    } catch (userError) {
      console.error("Resend Error (User):", userError);
      // Not throwing error here so the user form submission still succeeds
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Contact Form Error:", err);
    next(err);
  }
});

export default router;
