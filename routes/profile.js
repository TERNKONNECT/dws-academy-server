import express from "express";
import multer from "multer";
import User from "../models/User.js";
import { protect, adminOnly } from "../middleware/auth.js";
import { uploadFile, deleteFile, getFileUrl } from "../config/storage.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

async function serializeProfile(user) {
  const data = user.toJSON ? user.toJSON() : user;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    title: data.title,
    bio: data.bio,
    avatar: await getFileUrl(data.avatarCloudinaryId, data.avatar),
    role: data.role,
    createdAt: data.createdAt,
  };
}

// GET /api/profile — get logged-in admin's profile
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "name",
        "email",
        "title",
        "bio",
        "avatar",
        "avatarCloudinaryId",
        "role",
        "createdAt",
      ],
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(await serializeProfile(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile — update name, title, bio
router.put("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, title, bio } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.update({ name, title, bio });
    res.json(await serializeProfile(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/avatar — upload avatar image
router.post(
  "/avatar",
  protect,
  adminOnly,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No image uploaded" });
      const user = await User.findByPk(req.user.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (user.avatarCloudinaryId) {
        await deleteFile(user.avatarCloudinaryId, "image");
      }

      const fileData = await uploadFile(req.file, "lms/avatars");
      await user.update({
        avatar: fileData.url,
        avatarCloudinaryId: fileData.id,
      });
      res.json(await serializeProfile(user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/profile/:adminId — public profile of an instructor (for DWSAcademy -ui)
router.get("/:adminId", async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.adminId, role: "admin" },
      attributes: [
        "id",
        "name",
        "title",
        "bio",
        "avatar",
        "avatarCloudinaryId",
        "createdAt",
      ],
    });
    if (!user) return res.status(404).json({ error: "Instructor not found" });
    const profile = await serializeProfile(user);
    delete profile.email;
    delete profile.role;
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/avatar-url — save avatar URL from Cloudinary
router.post("/avatar-url", protect, adminOnly, async (req, res) => {
  try {
    const { avatar, avatarCloudinaryId } = req.body;
    if (!avatar)
      return res.status(400).json({ error: "Avatar URL is required" });
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.update({ avatar, avatarCloudinaryId });
    res.json(await serializeProfile(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
