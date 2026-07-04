import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, closeTestDb, app } from "./helpers/db.js";
import { createUser, createCourse, signTokenFor } from "./helpers/factories.js";

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("Courses: public listing and detail access", () => {
  it("lists only published courses for anonymous visitors", async () => {
    await createCourse({ title: "Published Course", status: "published" });
    await createCourse({ title: "Draft Course", status: "draft" });

    const res = await request(app).get("/api/courses");
    assert.equal(res.status, 200);
    const titles = res.body.map((c) => c.title);
    assert.ok(titles.includes("Published Course"));
    assert.ok(!titles.includes("Draft Course"));
  });

  it("returns a single published course with its module structure", async () => {
    const course = await createCourse({ title: "Detail Course", status: "published" });

    const res = await request(app).get(`/api/courses/${course.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.title, "Detail Course");
    assert.ok(Array.isArray(res.body.modules));
  });

  it("404s for a course that does not exist", async () => {
    const res = await request(app).get("/api/courses/00000000-0000-0000-0000-000000000000");
    assert.equal(res.status, 404);
  });

  it("lets an admin see their own draft courses in the listing when authenticated", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    await createCourse({ title: "My Draft", status: "draft", createdBy: admin.id });
    const token = signTokenFor(admin);

    const res = await request(app)
      .get("/api/courses")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.some((c) => c.title === "My Draft"));
  });
});
