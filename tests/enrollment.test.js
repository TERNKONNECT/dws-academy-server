import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, closeTestDb, app } from "./helpers/db.js";
import {
  createUser,
  createCourse,
  createModule,
  createLesson,
  signTokenFor,
} from "./helpers/factories.js";

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("Enrollment: self-enroll in a free course", () => {
  it("enrolls a logged-in user in a published free course", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free", price: 0 });
    const token = signTokenFor(user);

    const res = await request(app)
      .post(`/api/enrollments/${course.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 201);
    assert.equal(res.body.userId, user.id);
    assert.equal(res.body.courseId, course.id);
  });

  it("rejects a second enrollment in the same course", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free", price: 0 });
    const token = signTokenFor(user);

    await request(app).post(`/api/enrollments/${course.id}`).set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post(`/api/enrollments/${course.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 400);
  });

  it("blocks self-enrollment in a paid course (payment required first)", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const token = signTokenFor(user);

    const res = await request(app)
      .post(`/api/enrollments/${course.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 402);
  });

  it("requires authentication to enroll", async () => {
    const course = await createCourse({ pricingType: "free" });
    const res = await request(app).post(`/api/enrollments/${course.id}`);
    assert.equal(res.status, 401);
  });
});

describe("Enrollment: admin enrolls a student by email", () => {
  it("enrolls an already-registered user by email", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const student = await createUser({ email: "student-for-admin@example.com" });
    const course = await createCourse({ pricingType: "free", createdBy: admin.id });
    const token = signTokenFor(admin);

    const res = await request(app)
      .post("/api/enrollments/admin/enroll")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: student.email, courseId: course.id });

    assert.equal(res.status, 201);
    assert.equal(res.body.enrollment.user.email, student.email);
  });

  it("rejects enrolling an email that has no account on the platform", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({ pricingType: "free", createdBy: admin.id });
    const token = signTokenFor(admin);

    const res = await request(app)
      .post("/api/enrollments/admin/enroll")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "ghost@example.com", courseId: course.id });

    assert.equal(res.status, 404);
    assert.match(res.body.error, /does not exist/i);
  });

  it("rejects a non-admin user from using the admin-enroll endpoint", async () => {
    const user = await createUser();
    const student = await createUser({ email: "another-student@example.com" });
    const course = await createCourse({ pricingType: "free" });
    const token = signTokenFor(user);

    const res = await request(app)
      .post("/api/enrollments/admin/enroll")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: student.email, courseId: course.id });

    assert.equal(res.status, 403);
  });
});

describe("Enrollment: lesson/video completion tracking", () => {
  it("marks a lesson complete and reports progress, then completes the course on the last lesson", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    const lesson1 = await createLesson(mod, { order: 1 });
    const lesson2 = await createLesson(mod, { order: 2 });
    const token = signTokenFor(user);

    await request(app).post(`/api/enrollments/${course.id}`).set("Authorization", `Bearer ${token}`);

    const first = await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson1.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.completedLessons, 1);
    assert.equal(first.body.totalLessons, 2);
    assert.equal(first.body.courseCompleted, false);

    const second = await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson2.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(second.status, 200);
    assert.equal(second.body.completedLessons, 2);
    assert.equal(second.body.courseCompleted, true);
  });

  it("does not double-count completing the same lesson twice", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    const lesson = await createLesson(mod, { order: 1 });
    const token = signTokenFor(user);

    await request(app).post(`/api/enrollments/${course.id}`).set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson.id}/complete`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.alreadyCompleted, true);
    assert.equal(res.body.completedLessons, 1);
  });

  it("rejects marking a lesson complete for a course the user is not enrolled in", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    const lesson = await createLesson(mod);
    const token = signTokenFor(user);

    const res = await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  it("reports progress via the progress endpoint", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    const lesson = await createLesson(mod);
    const token = signTokenFor(user);

    await request(app).post(`/api/enrollments/${course.id}`).set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/api/enrollments/${course.id}/lessons/${lesson.id}/complete`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .get(`/api/enrollments/${course.id}/progress`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.progressPct, 100);
    assert.equal(res.body.isCompleted, true);
  });
});
