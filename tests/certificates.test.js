import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, closeTestDb, app } from "./helpers/db.js";
import { createUser, createCourse, createEnrollment, signTokenFor } from "./helpers/factories.js";
import Certificate from "../models/Certificate.js";

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("Certificates: issuing", () => {
  it("rejects issuing a certificate for a course that isn't completed", async () => {
    const user = await createUser({ name: "Ada Lovelace" });
    const course = await createCourse({ title: "Intro to Programming" });
    await createEnrollment(user, course, { isCompleted: false });

    const res = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 403);
  });

  it("rejects issuing a certificate for a course the user isn't enrolled in at all", async () => {
    const user = await createUser();
    const course = await createCourse();

    const res = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 403);
  });

  it("issues a certificate with a snapshot of the student/course names once the course is completed", async () => {
    const user = await createUser({ name: "Grace Hopper" });
    const instructor = await createUser({ name: "Alan Turing", role: "admin" });
    const course = await createCourse({ title: "Compilers 101", createdBy: instructor.id });
    await createEnrollment(user, course, {
      isCompleted: true,
      completedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    const res = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 201);
    assert.match(res.body.certificateId, /^DWS-[A-F0-9]{8}$/);
    assert.equal(res.body.studentName, "Grace Hopper");
    assert.equal(res.body.courseName, "Compilers 101");
    assert.equal(res.body.instructorName, "Alan Turing");
  });

  it("is idempotent — calling issue again returns the same certificate, not a new one", async () => {
    const user = await createUser({ name: "Margaret Hamilton" });
    const course = await createCourse({ title: "Software Engineering" });
    await createEnrollment(user, course, { isCompleted: true, completedAt: new Date() });

    const first = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });
    const second = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(first.body.certificateId, second.body.certificateId);

    const count = await Certificate.count({ where: { userId: user.id, courseId: course.id } });
    assert.equal(count, 1);
  });

  it("requires authentication to issue a certificate", async () => {
    const course = await createCourse();
    const res = await request(app).post("/api/certificates/issue").send({ courseId: course.id });
    assert.equal(res.status, 401);
  });
});

describe("Certificates: fetching your own", () => {
  it("404s when no certificate has been issued yet for that course", async () => {
    const user = await createUser();
    const course = await createCourse();
    await createEnrollment(user, course, { isCompleted: false });

    const res = await request(app)
      .get(`/api/certificates/mine/${course.id}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);
    assert.equal(res.status, 404);
  });

  it("returns the caller's own issued certificate", async () => {
    const user = await createUser({ name: "Katherine Johnson" });
    const course = await createCourse({ title: "Orbital Mechanics" });
    await createEnrollment(user, course, { isCompleted: true, completedAt: new Date() });
    await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    const res = await request(app)
      .get(`/api/certificates/mine/${course.id}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.studentName, "Katherine Johnson");
  });
});

describe("Certificates: public verification", () => {
  it("confirms a genuine certificate by its public code, with no authentication required", async () => {
    const user = await createUser({ name: "Radia Perlman" });
    const course = await createCourse({ title: "Networking Fundamentals" });
    await createEnrollment(user, course, { isCompleted: true, completedAt: new Date() });
    const issued = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    const res = await request(app).get(`/api/certificates/verify/${issued.body.certificateId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.studentName, "Radia Perlman");
    assert.equal(res.body.courseName, "Networking Fundamentals");
  });

  it("is case-insensitive on the certificate code", async () => {
    const user = await createUser();
    const course = await createCourse();
    await createEnrollment(user, course, { isCompleted: true, completedAt: new Date() });
    const issued = await request(app)
      .post("/api/certificates/issue")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    const res = await request(app).get(
      `/api/certificates/verify/${issued.body.certificateId.toLowerCase()}`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
  });

  it("returns valid:false for a certificate code that doesn't exist", async () => {
    const res = await request(app).get("/api/certificates/verify/DWS-NOTREAL1");
    assert.equal(res.status, 404);
    assert.equal(res.body.valid, false);
  });
});
