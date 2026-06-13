import express from "express";
import { protect, superAdminOnly } from "../middleware/auth.js";
import Event from "../models/Event.js";
import EventImage from "../models/EventImage.js";
import { createUploadUrl, deleteFile } from "../config/storage.js";

const router = express.Router();

// Public: Get all events with their images
router.get("/", async (req, res) => {
  try {
    const events = await Event.findAll({
      include: [{ model: EventImage, as: "images" }],
      order: [["createdAt", "DESC"]],
    });

    const formattedEvents = events.map((event) => {
      const e = event.toJSON();
      if (!e.date) delete e.date;
      return e;
    });

    res.json(formattedEvents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SuperAdmin: Create an event
router.post("/", protect, superAdminOnly, async (req, res) => {
  try {
    const { name, description, date } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const event = await Event.create({ name, description, date: date || null });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SuperAdmin: Delete an event (also deletes images from S3 and DB via cascade/manual)
router.delete("/:id", protect, superAdminOnly, async (req, res) => {
  try {
    const event = await Event.findByPk(req.params.id, {
      include: [{ model: EventImage, as: "images" }],
    });
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Delete images from S3
    for (const image of event.images) {
      await deleteFile(image.key, "image").catch((err) =>
        console.error("Failed to delete S3 image:", err),
      );
    }

    await event.destroy(); // Cascade delete event_images in DB
    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SuperAdmin: Get presigned URL for uploading an image
router.post("/:id/images/presigned-url", protect, superAdminOnly, async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const safeEventName = event.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const folder = `gallery/${safeEventName}`;

    const uploadData = await createUploadUrl({ filename, contentType, folder });
    res.json(uploadData); // { uploadUrl, key, url }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SuperAdmin: Save uploaded image records to DB
router.post("/:id/images", protect, superAdminOnly, async (req, res) => {
  try {
    const { images } = req.body; // Array of { url, key }
    const eventId = req.params.id;

    const event = await Event.findByPk(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "No images provided" });
    }

    const createdImages = await EventImage.bulkCreate(
      images.map((img) => ({ eventId, url: img.url, key: img.key }))
    );

    res.status(201).json(createdImages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SuperAdmin: Bulk delete images
router.delete("/images/bulk", protect, superAdminOnly, async (req, res) => {
  try {
    const { imageIds } = req.body; // Array of EventImage UUIDs
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: "No image IDs provided" });
    }

    const images = await EventImage.findAll({ where: { id: imageIds } });

    for (const image of images) {
      await deleteFile(image.key, "image").catch((err) =>
        console.error("Failed to delete S3 image:", err),
      );
      await image.destroy();
    }

    res.json({ message: "Images deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
