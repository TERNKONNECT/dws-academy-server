import express from "express";
import { protect, superAdminOnly } from "../middleware/auth.js";
import GalleryCategory from "../models/GalleryCategory.js";
import EventImage from "../models/EventImage.js";
import { deleteFile } from "../config/storage.js";

const router = express.Router();

// Public: active categories only, for filtering/sorting the public gallery
router.get("/", async (req, res, next) => {
  try {
    const categories = await GalleryCategory.findAll({
      where: { isActive: true },
      order: [["name", "ASC"]],
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: all categories, including inactive ones, for management
router.get("/admin", protect, superAdminOnly, async (req, res, next) => {
  try {
    const categories = await GalleryCategory.findAll({
      order: [["name", "ASC"]],
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: create a category
router.post("/", protect, superAdminOnly, async (req, res, next) => {
  try {
    const { name, description, isActive, date } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const category = await GalleryCategory.create({
      name,
      description: description || "",
      isActive: isActive !== undefined ? isActive : true,
      date: date || null,
    });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: update a category
router.put("/:id", protect, superAdminOnly, async (req, res, next) => {
  try {
    const category = await GalleryCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: "Category not found" });

    const { name, description, isActive, date } = req.body;
    await category.update({
      name: name !== undefined ? name : category.name,
      description: description !== undefined ? description : category.description,
      isActive: isActive !== undefined ? isActive : category.isActive,
      date: date !== undefined ? date : category.date,
    });
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// SuperAdmin: delete a category and every image filed under it
router.delete("/:id", protect, superAdminOnly, async (req, res, next) => {
  try {
    const category = await GalleryCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: "Category not found" });

    const images = await EventImage.findAll({ where: { categoryId: category.id } });
    for (const image of images) {
      await deleteFile(image.key, "image").catch((err) =>
        console.error("Failed to delete S3 image:", err),
      );
      await image.destroy();
    }

    await category.destroy();
    res.json({ message: "Category and its images deleted successfully", deletedImages: images.length });
  } catch (err) {
    next(err);
  }
});

export default router;
