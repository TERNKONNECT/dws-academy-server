import express from "express";
import Testimonial from "../models/Testimonial.js";
import { protect, adminOnly } from "../middleware/auth.js";
import { imageUpload } from "../middleware/uploads.js";
import { uploadFile, deleteFile, getFileUrl } from "../config/storage.js";

async function serializeTestimonial(testimonial) {
  const data = testimonial.toJSON ? testimonial.toJSON() : testimonial;
  return {
    ...data,
    image: await getFileUrl(data.imageCloudinaryId, data.image),
  };
}

const router = express.Router();

// GET /api/testimonials — get all active testimonials (public)
router.get("/", async (req, res, next) => {
  try {
    const testimonials = await Testimonial.findAll({
      where: { isActive: true },
      order: [["date", "DESC"], ["createdAt", "DESC"]],
      limit: 10,
    });
    res.json(await Promise.all(testimonials.map(serializeTestimonial)));
  } catch (err) {
    next(err);
  }
});

// GET /api/testimonials/admin — admin sees all testimonials
router.get("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonials = await Testimonial.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json(await Promise.all(testimonials.map(serializeTestimonial)));
  } catch (err) {
    next(err);
  }
});

// POST /api/testimonials/admin — create a testimonial
router.post("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const { name, jobTitle, companyName, content, date, isActive } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: "Name and content are required." });
    }

    const testimonial = await Testimonial.create({
      name,
      jobTitle: jobTitle || "",
      companyName: companyName || "",
      content,
      date: date || new Date(),
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json(await serializeTestimonial(testimonial));
  } catch (err) {
    next(err);
  }
});

// PUT /api/testimonials/admin/:id — update a testimonial
router.put("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    const { name, jobTitle, companyName, content, date, isActive } = req.body;

    await testimonial.update({
      name: name !== undefined ? name : testimonial.name,
      jobTitle: jobTitle !== undefined ? jobTitle : testimonial.jobTitle,
      companyName: companyName !== undefined ? companyName : testimonial.companyName,
      content: content !== undefined ? content : testimonial.content,
      date: date !== undefined ? date : testimonial.date,
      isActive: isActive !== undefined ? isActive : testimonial.isActive,
    });

    res.json(await serializeTestimonial(testimonial));
  } catch (err) {
    next(err);
  }
});

// POST /api/testimonials/admin/:id/image — upload (or replace) the testimonial's photo.
// Optional by design: a testimonial with no image renders fine on the public page,
// falling back to initials. Uploading a new one replaces and deletes the old file.
router.post(
  "/admin/:id/image",
  protect,
  adminOnly,
  imageUpload.single("image"),
  async (req, res, next) => {
    try {
      const testimonial = await Testimonial.findByPk(req.params.id);
      if (!testimonial) {
        return res.status(404).json({ error: "Testimonial not found" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      if (testimonial.imageCloudinaryId) {
        await deleteFile(testimonial.imageCloudinaryId, "image");
      }

      const fileData = await uploadFile(req.file, "lms/testimonials");
      await testimonial.update({
        image: fileData.url,
        imageCloudinaryId: fileData.id,
      });

      res.json(await serializeTestimonial(testimonial));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/testimonials/admin/:id/image — remove the photo, keep the testimonial
router.delete("/admin/:id/image", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    if (testimonial.imageCloudinaryId) {
      await deleteFile(testimonial.imageCloudinaryId, "image");
    }
    await testimonial.update({ image: "", imageCloudinaryId: "" });

    res.json(await serializeTestimonial(testimonial));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/testimonials/admin/:id — delete a testimonial
router.delete("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const testimonial = await Testimonial.findByPk(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ error: "Testimonial not found" });
    }

    if (testimonial.imageCloudinaryId) {
      await deleteFile(testimonial.imageCloudinaryId, "image");
    }
    await testimonial.destroy();
    res.json({ message: "Testimonial deleted successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;
