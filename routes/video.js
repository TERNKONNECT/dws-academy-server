import express from "express";
import multer from "multer";
import Video from "../models/Video.js";
import Course from "../models/Course.js";
import { protect, adminOnly } from "../middleware/auth.js";
import { uploadFile, deleteFile } from "../config/storage.js";

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", async (req, res) => {
  try {
    const videos = await Video.findAll({
      where: { courseId: req.params.courseId },
      order: [["createdAt", "DESC"]],
    });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const video = await Video.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!video) return res.status(404).json({ error: "Video not found" });
    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// router.post(
//   "/",
//   protect,
//   adminOnly,
//   upload.single("video"),
//   async (req, res) => {
//     try {
//       const course = await Course.findByPk(req.params.courseId);
//       if (!course) return res.status(404).json({ error: "Course not found" });
//       if (!req.file)
//         return res.status(400).json({ error: "No video file uploaded" });

//       const { title, description, duration, difficulty } = req.body;
//       const video = await Video.create({
//         courseId: req.params.courseId,
//         title,
//         description,
//         filename: req.file.originalname,
//         url: req.file.path,
//         cloudinaryId: req.file.filename,
//         duration,
//         difficulty,
//       });
//       res.status(201).json(video);
//     } catch (err) {
//       res.status(500).json({ error: err.message });
//     }
//   },
// );

router.post(
  "/",
  protect,
  adminOnly,
  upload.single("video"),
  async (req, res) => {
    try {
      const course = await Course.findByPk(req.params.courseId);
      if (!course) return res.status(404).json({ error: "Course not found" });

      const { title, description, duration, difficulty, youtubeUrl } = req.body;

      if (!req.file && !youtubeUrl)
        return res
          .status(400)
          .json({ error: "Provide a video file or YouTube URL" });

      const fileData = req.file ? await uploadFile(req.file, "lms/videos") : null;
      const video = await Video.create({
        courseId: req.params.courseId,
        title,
        description,
        duration,
        difficulty,
        filename: req.file?.originalname || "",
        url: fileData?.url || youtubeUrl,
        cloudinaryId: fileData?.id || "",
        youtubeUrl: youtubeUrl || "",
      });
      res.status(201).json(video);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!video) return res.status(404).json({ error: "Video not found" });
    const { title, description, duration, difficulty } = req.body;
    await video.update({ title, description, duration, difficulty });
    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findOne({
      where: { id: req.params.id, courseId: req.params.courseId },
    });
    if (!video) return res.status(404).json({ error: "Video not found" });

    if (video.cloudinaryId) {
      await deleteFile(video.cloudinaryId, "video");
    }

    await video.destroy();
    res.json({ message: "Video deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
