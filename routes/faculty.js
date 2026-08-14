import express from "express";
import { protect, adminOnly } from "../middleware/auth.js";
import Faculty from "../models/Faculty.js";
import multer from "multer";
import { uploadFile, deleteFile } from "../config/storage.js";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// GET /api/faculty — public endpoint to fetch active faculty (limited to 4)
router.get("/", async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const options = {
      where: { isActive: true },
      order: [["createdAt", "DESC"]],
    };
    if (limit && !isNaN(limit)) {
      options.limit = limit;
    }
    const faculties = await Faculty.findAll(options);
    res.json(faculties);
  } catch (error) {
    next(error);
  }
});

// GET /api/faculty/admin — admin endpoint to fetch all faculty
router.get("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const faculties = await Faculty.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json(faculties);
  } catch (error) {
    next(error);
  }
});

// POST /api/faculty/admin — create a faculty member
router.post("/admin", protect, adminOnly, async (req, res, next) => {
  try {
    const { name, jobTitle, company, shortDescription, avatar, isActive } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "Name is required." });
    }
    
    const faculty = await Faculty.create({
      name,
      jobTitle: jobTitle || "",
      company: company || "",
      shortDescription: shortDescription || "",
      avatar: avatar || "",
      isActive: isActive !== undefined ? isActive : true,
    });
    
    res.status(201).json(faculty);
  } catch (error) {
    next(error);
  }
});

// PUT /api/faculty/admin/:id — update a faculty member
router.put("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const faculty = await Faculty.findByPk(req.params.id);
    if (!faculty) {
      return res.status(404).json({ error: "Faculty not found" });
    }
    
    const { name, jobTitle, company, shortDescription, avatar, isActive } = req.body;
    
    await faculty.update({
      name: name !== undefined ? name : faculty.name,
      jobTitle: jobTitle !== undefined ? jobTitle : faculty.jobTitle,
      company: company !== undefined ? company : faculty.company,
      shortDescription: shortDescription !== undefined ? shortDescription : faculty.shortDescription,
      avatar: avatar !== undefined ? avatar : faculty.avatar,
      isActive: isActive !== undefined ? isActive : faculty.isActive,
    });
    
    res.json(faculty);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/faculty/admin/:id — delete a faculty member
router.delete("/admin/:id", protect, adminOnly, async (req, res, next) => {
  try {
    const faculty = await Faculty.findByPk(req.params.id);
    if (!faculty) {
      return res.status(404).json({ error: "Faculty not found" });
    }
    
    await faculty.destroy();
    res.json({ message: "Faculty removed successfully" });
  } catch (error) {
    next(error);
  }
});

// POST /api/faculty/admin/:id/avatar — upload faculty avatar
router.post("/admin/:id/avatar", protect, adminOnly, upload.single("avatar"), async (req, res, next) => {
  try {
    const faculty = await Faculty.findByPk(req.params.id);
    if (!faculty) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const fileData = await uploadFile(req.file, "lms/faculty");
    
    // Optional: Delete old avatar from Cloudinary/S3 if it exists
    // (Skipping for now to keep it simple, but good practice)

    await faculty.update({
      avatar: fileData.url,
    });

    res.json(faculty);
  } catch (error) {
    next(error);
  }
});

export default router;
