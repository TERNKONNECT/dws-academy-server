import "dotenv/config";
import express from "express";
import { pathToFileURL } from "url";
import { connectDB } from "./config/db.js";
import User from "./models/User.js";
import { setupCourseAssociations } from "./models/Course.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import moduleRoutes from "./routes/modules.js";
import lessonRoutes from "./routes/lessons.js";
import quizRoutes from "./routes/quizzes.js";
import enrollmentRoutes from "./routes/enrollment.js";
import superAdminRoutes from "./routes/superadmin.js";
import profileRoutes from "./routes/profile.js";
import reviewRoutes from "./routes/reviews.js";

setupCourseAssociations(User);
const dbReady = connectDB(); // Connect and apply additive schema guards once at startup

const app = express();

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json());

app.use(async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch {
    res.status(503).json({ error: "Database is not ready" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/courses/:courseId/modules", moduleRoutes);
app.use("/api/courses/:courseId/modules/:moduleId/lessons", lessonRoutes);
app.use("/api/courses/:courseId/modules/:moduleId/quiz", quizRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/reviews", reviewRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.send("API is running"));

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await dbReady;
  app.listen(process.env.PORT || 9000, () => {
    console.log(
      `Backend running on http://localhost:${process.env.PORT || 9000}`,
    );
  });
}

export default app;
