import express from "express";
import { Resend } from "resend";

const router = express.Router();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

router.post("/", async (req, res, next) => {
  try {
    const { name, email, company, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY is not configured.");
      return res.status(500).json({ error: "Email service is not configured" });
    }

    const { data, error } = await resend.emails.send({
      from: "School of Events Africa <onboarding@resend.dev>", // Replace with verified domain if available
      to: ["schoolofeventsafrica@gmail.com"],
      subject: `New Contact Form Submission: ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Company:</strong> ${company || "N/A"}</p>
        <p><strong>Subject (Area of Interest):</strong> ${subject}</p>
        <h3>Message:</h3>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });

    if (error) {
      console.error("Resend Error:", error);
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Contact Form Error:", err);
    next(err);
  }
});

export default router;
