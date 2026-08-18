import express from "express";
import path from "path";
import { protect, superAdminOnly } from "../middleware/auth.js";
import Event from "../models/Event.js";
import EventImage from "../models/EventImage.js";
import GalleryCategory from "../models/GalleryCategory.js";
import { createUploadUrl, deleteFile, getFileUrl } from "../config/storage.js";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// Public: Get all events with their images
router.get("/", async (req, res, next) => {
  try {
    const events = await Event.findAll({
      include: [
        {
          model: EventImage,
          as: "images",
          include: [{ model: GalleryCategory, as: "category" }],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const e = event.toJSON();
        if (!e.date) delete e.date;
        if (e.images) {
          e.images = await Promise.all(
            e.images.map(async (img) => ({
              ...img,
              url: await getFileUrl(img.key, img.url),
            }))
          );
        }
        return e;
      })
    );

    res.json(formattedEvents);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: Create an event
router.post("/", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { name, description, date } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const event = await Event.create({ name, description, date: date || null });
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: Delete an event (also deletes images from S3 and DB via cascade/manual)
router.delete("/:id", protect, superAdminOnly, async (req, res, next) => {
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
    next(err);
  }
});

const getRawBody = (req) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
};

// SuperAdmin: Get presigned URL for uploading an image
router.post("/:id/images/presigned-url", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { filename, contentType } = req.body;
    const event = await Event.findByPk(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const safeEventName = event.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const folder = `gallery/${safeEventName}`;

    if (process.env.NODE_ENV === "production") {
      const uploadData = await createUploadUrl({ filename, contentType, folder });
      res.json(uploadData); // { uploadUrl, key, url }
    } else {
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = path.extname(safeName) || ".jpg";
      const baseName = path.parse(safeName).name;
      const key = `${folder}/${Date.now()}-${baseName}`;

      const host = req.get("host");
      const protocol = req.protocol;
      const uploadUrl = `${protocol}://${host}/api/events/${req.params.id}/images/dev-upload?key=${encodeURIComponent(key)}`;

      const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${key}${ext}`;

      res.json({ uploadUrl, key, url });
    }
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: Dev endpoint to handle local file upload to Cloudinary via PUT
router.put("/:id/images/dev-upload", protect, superAdminOnly, async (req, res, next) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "Key query parameter is required" });

    const buffer = await getRawBody(req);

    await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: key,
          resource_type: "image",
          overwrite: true,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(buffer);
    });

    res.json({ message: "Dev image uploaded to Cloudinary successfully" });
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: Save uploaded image records to DB
router.post("/:id/images", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { images, categoryId } = req.body; // images: Array of { url, key }
    const eventId = req.params.id;

    const event = await Event.findByPk(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "No images provided" });
    }

    let resolvedCategoryId = 1;
    if (categoryId !== undefined && categoryId !== null) {
      const category = await GalleryCategory.findByPk(categoryId);
      if (!category) return res.status(400).json({ error: "Category not found" });
      resolvedCategoryId = category.id;
    }

    const createdImages = await EventImage.bulkCreate(
      images.map((img) => ({ eventId, url: img.url, key: img.key, categoryId: resolvedCategoryId }))
    );

    const formattedCreatedImages = await Promise.all(
      createdImages.map(async (img) => {
        const imgJson = img.toJSON();
        return {
          ...imgJson,
          url: await getFileUrl(imgJson.key, imgJson.url),
        };
      })
    );

    res.status(201).json(formattedCreatedImages);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: Bulk delete images
router.delete("/images/bulk", protect, superAdminOnly, async (req, res, next) => {
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
    next(err);
  }
});

export default router;
