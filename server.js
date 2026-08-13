import "dotenv/config";
import express from "express";

// A rejection with no attached .catch() anywhere (e.g. a stray background retry in
// a library, not something a route's try/catch or the error middleware could ever
// see) otherwise reaches Lambda's runtime as a raw, request-less stack dump —
// exactly the unhelpful "Unhandled Rejection" shape with no context that's hard to
// trace back to a cause. Logging it in the same structured shape as everything
// else at least makes it findable.
process.on("unhandledRejection", (err) => {
  console.error(
    JSON.stringify({
      scope: "process",
      event: "unhandled_rejection",
      message: err?.message || String(err),
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    }),
  );
});
import { pathToFileURL } from "url";
import { connectDB } from "./config/db.js";
import User from "./models/User.js";
import { setupCourseAssociations } from "./models/Course.js";
import Event, { setupEventAssociations } from "./models/Event.js";
import EventImage, { setupEventImageAssociations } from "./models/EventImage.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import moduleRoutes from "./routes/modules.js";
import lessonRoutes from "./routes/lessons.js";
import quizRoutes from "./routes/quizzes.js";
import enrollmentRoutes from "./routes/enrollment.js";
import superAdminRoutes from "./routes/superadmin.js";
import profileRoutes from "./routes/profile.js";
import reviewRoutes from "./routes/reviews.js";
import paymentRoutes from "./routes/payments.js";
import eventsRoutes from "./routes/events.js";
import certificateRoutes from "./routes/certificates.js";
import testimonialRoutes from "./routes/testimonials.js";
import facultyRoutes from "./routes/faculty.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { uploadErrorHandler } from "./middleware/uploads.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import "./models/Payment.js";
import "./models/QuizAttempt.js";
import "./models/Certificate.js";
import "./models/Testimonial.js";
import "./models/Faculty.js";

setupCourseAssociations(User);
setupEventAssociations(EventImage);
setupEventImageAssociations(Event);

// Kick the connection off at cold start so it's often already ready by the time the
// first request reaches the middleware below. Guarded with a no-op catch so a
// startup failure (e.g. the DB not answering) surfaces as a normal 503 to the
// caller instead of an "Unhandled Rejection" with no request context in the logs.
//
// Deliberately not captured in a variable and reused per-request — `connectDB()`
// resets its internal promise to null on failure, so calling it again retries.
// A Lambda container is reused warm across many invocations; if we awaited one
// fixed promise from cold start, a single transient DB hiccup (a paused Supabase
// project, a dropped pooler connection) would 503 every request in that container
// forever, since the same already-rejected promise never changes. Calling
// connectDB() fresh each time means the very next request retries.
connectDB().catch(() => {});

const app = express();
app.set("trust proxy", 1); // Behind Vercel/API Gateway, so req.ip reads X-Forwarded-For.

// CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "https://schoolofeventsafrica.com",
  "https://www.schoolofeventsafrica.com",
  "https://dws.ternkonnect.com",
  "https://dws-academy-server.vercel.app",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Unknown origins get no CORS header at all. The previous `*` fallback meant the
  // allowlist had no effect, and would have become a real hole the moment anything
  // moved to cookie auth.
  if (
    origin &&
    (allowedOrigins.includes(origin) ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Paystack-Signature",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Baseline security headers. This is a JSON API with no HTML surface of its own, so
// the useful set is small — written out rather than pulling in a dependency.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  res.removeHeader("X-Powered-By");
  next();
});

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(async (req, res, next) => {
  try {
    // Calling connectDB() here rather than awaiting a promise captured at cold
    // start is what makes this retry: once already connected it resolves
    // immediately with no network round-trip, but if the last attempt failed it
    // tries again on this request instead of repeating a stale rejection.
    await connectDB();
    next();
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "db",
        event: "connection_unavailable",
        message: err?.message,
      }),
    );
    res.status(503).json({ error: "Database is not ready" });
  }
});

app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/courses/:courseId/modules", moduleRoutes);
app.use("/api/courses/:courseId/modules/:moduleId/lessons", lessonRoutes);
app.use("/api/courses/:courseId/modules/:moduleId/quiz", quizRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/testimonials", testimonialRoutes);
app.use("/api/faculty", facultyRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.send("API is running"));

// Order matters: multer errors become clean 400s, everything else is logged with a
// reference and answered generically, so Sequelize never narrates the schema to a
// caller.
app.use(notFoundHandler);
app.use(uploadErrorHandler);
app.use(errorHandler);

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await connectDB();
  app.listen(process.env.PORT || 9000, () => {
    console.log(
      `Backend running on http://localhost:${process.env.PORT || 9000}`,
    );
  });
}

export default app;
