import jwt from "jsonwebtoken";
import User from "../../models/User.js";
import Course from "../../models/Course.js";
import Module from "../../models/Module.js";
import Lesson from "../../models/Lesson.js";
import Quiz from "../../models/Quiz.js";
import Enrollment from "../../models/Enrollment.js";
import Payment from "../../models/Payment.js";

let counter = 0;
const unique = (label) => `${label}-${Date.now()}-${counter++}`;

export async function createUser(overrides = {}) {
  return User.create({
    name: overrides.name ?? "Test User",
    email: overrides.email ?? `${unique("user")}@example.com`,
    password: overrides.password ?? "password123",
    role: overrides.role ?? "user",
    emailVerified: overrides.emailVerified ?? true,
    ...overrides,
  });
}

export function signTokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export async function createCourse(overrides = {}) {
  const createdBy = overrides.createdBy ?? (await createUser({ role: "admin" })).id;
  return Course.create({
    title: overrides.title ?? "Test Course",
    status: overrides.status ?? "published",
    pricingType: overrides.pricingType ?? "free",
    price: overrides.price ?? 0,
    createdBy,
    ...overrides,
    createdBy,
  });
}

export async function createModule(course, overrides = {}) {
  return Module.create({
    courseId: course.id,
    title: overrides.title ?? "Test Module",
    order: overrides.order ?? 1,
    ...overrides,
  });
}

export async function createLesson(module, overrides = {}) {
  return Lesson.create({
    moduleId: module.id,
    title: overrides.title ?? "Test Lesson",
    type: overrides.type ?? "video",
    videoUrl: overrides.videoUrl ?? "https://example.com/video.mp4",
    order: overrides.order ?? 1,
    ...overrides,
  });
}

export async function createQuiz(module, overrides = {}) {
  return Quiz.create({
    moduleId: module.id,
    title: overrides.title ?? "Test Quiz",
    questions: overrides.questions ?? [
      {
        id: "q1",
        text: "2 + 2 = ?",
        type: "mcq",
        options: ["3", "4", "5", "6"],
        correctIndex: 1,
      },
      {
        id: "q2",
        text: "Capital of France?",
        type: "mcq",
        options: ["Berlin", "Paris", "Rome", "Madrid"],
        correctIndex: 1,
      },
    ],
    ...overrides,
  });
}

export async function createEnrollment(user, course, overrides = {}) {
  return Enrollment.create({
    userId: user.id,
    courseId: course.id,
    ...overrides,
  });
}

export async function createPayment(user, course, overrides = {}) {
  return Payment.create({
    userId: user.id,
    courseId: course.id,
    reference: overrides.reference ?? unique("payment-ref"),
    amount: overrides.amount ?? course.price ?? 5000,
    currency: overrides.currency ?? course.currency ?? "NGN",
    status: overrides.status ?? "pending",
    ...overrides,
  });
}
