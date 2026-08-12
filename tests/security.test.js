import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, closeTestDb, app } from "./helpers/db.js";
import {
  createUser,
  createCourse,
  createModule,
  createLesson,
  createQuiz,
  createEnrollment,
  signTokenFor,
} from "./helpers/factories.js";
import User from "../models/User.js";
import Enrollment from "../models/Enrollment.js";

// Regression tests for the findings in report.md. Each one fails against the code as
// it stood before the fix, so the hole can't quietly reopen.

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("C-1: paid course content is not readable without access", () => {
  it("refuses the modules listing to an anonymous visitor", async () => {
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const mod = await createModule(course);
    await createLesson(mod, { title: "Paid lesson" });

    const res = await request(app).get(`/api/courses/${course.id}/modules`);
    assert.equal(res.status, 403);
  });

  it("refuses the lessons listing to a signed-in user who is not enrolled", async () => {
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const mod = await createModule(course);
    await createLesson(mod, { videoUrl: "https://example.com/secret.mp4" });
    const outsider = await createUser();

    const res = await request(app)
      .get(`/api/courses/${course.id}/modules/${mod.id}/lessons`)
      .set("Authorization", `Bearer ${signTokenFor(outsider)}`);

    assert.equal(res.status, 403);
    assert.ok(
      !JSON.stringify(res.body).includes("secret.mp4"),
      "no media URL should appear in a refusal",
    );
  });

  it("serves the lessons to an enrolled student", async () => {
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const mod = await createModule(course);
    await createLesson(mod, { title: "Lesson one" });
    const student = await createUser();
    await createEnrollment(student, course);

    const res = await request(app)
      .get(`/api/courses/${course.id}/modules/${mod.id}/lessons`)
      .set("Authorization", `Bearer ${signTokenFor(student)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body[0].title, "Lesson one");
  });

  it("shows only a locked outline in the course detail for a non-enrolled visitor", async () => {
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const mod = await createModule(course);
    await createLesson(mod, { type: "text", content: "the actual lesson body" });

    const res = await request(app).get(`/api/courses/${course.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.hasAccess, false);
    assert.equal(res.body.modules[0].lessons[0].locked, true);
    assert.equal(res.body.modules[0].lessons[0].content, "");
  });
});

describe("C-2: quiz answers never reach a learner", () => {
  it("has no list-every-quiz endpoint", async () => {
    const course = await createCourse();
    const mod = await createModule(course);
    await createQuiz(mod);

    const res = await request(app).get("/api/quizzes");
    assert.notEqual(res.status, 200);
  });

  it("omits correctIndex when an enrolled student fetches the quiz", async () => {
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    const quiz = await createQuiz(mod);
    const student = await createUser();
    await createEnrollment(student, course);

    const res = await request(app)
      .get(`/api/quizzes/${quiz.id}`)
      .set("Authorization", `Bearer ${signTokenFor(student)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.questions.length, 2);
    for (const question of res.body.questions) {
      assert.equal(question.correctIndex, undefined);
      assert.equal(question.sampleAnswer, undefined);
    }
  });

  it("omits correctIndex from the quiz embedded in a course payload", async () => {
    const course = await createCourse({ pricingType: "free" });
    const mod = await createModule(course);
    await createQuiz(mod);
    const student = await createUser();
    await createEnrollment(student, course);

    const res = await request(app)
      .get(`/api/courses/${course.id}`)
      .set("Authorization", `Bearer ${signTokenFor(student)}`);

    assert.equal(res.status, 200);
    assert.ok(
      !JSON.stringify(res.body).includes("correctIndex"),
      "the answer key must not appear anywhere in a course response",
    );
  });

  it("still shows answers to the instructor who owns the course", async () => {
    const instructor = await createUser({ role: "admin" });
    const course = await createCourse({ createdBy: instructor.id });
    const mod = await createModule(course);
    const quiz = await createQuiz(mod);

    const res = await request(app)
      .get(`/api/quizzes/${quiz.id}`)
      .set("Authorization", `Bearer ${signTokenFor(instructor)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.questions[0].correctIndex, 1);
  });
});

describe("C-3: instructors cannot manage accounts or other instructors", () => {
  it("refuses an instructor the learner list", async () => {
    const instructor = await createUser({ role: "admin" });
    const res = await request(app)
      .get("/api/superadmin/users")
      .set("Authorization", `Bearer ${signTokenFor(instructor)}`);
    assert.equal(res.status, 403);
  });

  it("refuses an instructor deleting a user", async () => {
    const instructor = await createUser({ role: "admin" });
    const victim = await createUser();

    const res = await request(app)
      .delete(`/api/superadmin/users/${victim.id}`)
      .set("Authorization", `Bearer ${signTokenFor(instructor)}`);

    assert.equal(res.status, 403);
    assert.ok(await User.findByPk(victim.id), "the account must still exist");
  });

  it("refuses an instructor inviting another admin", async () => {
    const instructor = await createUser({ role: "admin" });
    const res = await request(app)
      .post("/api/superadmin/instructors/invite")
      .set("Authorization", `Bearer ${signTokenFor(instructor)}`)
      .send({ name: "Sneaky", email: "sneaky@example.com" });
    assert.equal(res.status, 403);
  });

  it("refuses even a super-admin deleting a staff account through the learner route", async () => {
    const superAdmin = await createUser({ role: "super-admin" });
    const otherAdmin = await createUser({ role: "admin" });

    const res = await request(app)
      .delete(`/api/superadmin/users/${otherAdmin.id}`)
      .set("Authorization", `Bearer ${signTokenFor(superAdmin)}`);

    assert.equal(res.status, 403);
    assert.ok(await User.findByPk(otherAdmin.id));
  });

  it("lets a super-admin delete a learner", async () => {
    const superAdmin = await createUser({ role: "super-admin" });
    const learner = await createUser();

    const res = await request(app)
      .delete(`/api/superadmin/users/${learner.id}`)
      .set("Authorization", `Bearer ${signTokenFor(superAdmin)}`);

    assert.equal(res.status, 200);
    assert.equal(await User.findByPk(learner.id), null);
  });
});

describe("H-2: completion cannot be forged with another course's lessons", () => {
  it("rejects a lesson id that belongs to a different course", async () => {
    const ownCourse = await createCourse({ pricingType: "free" });
    const ownModule = await createModule(ownCourse);
    await createLesson(ownModule, { title: "Real lesson" });

    const otherCourse = await createCourse({ pricingType: "free" });
    const otherModule = await createModule(otherCourse);
    const foreignLesson = await createLesson(otherModule, { title: "Elsewhere" });

    const student = await createUser();
    const enrollment = await createEnrollment(student, ownCourse);

    const res = await request(app)
      .post(
        `/api/enrollments/${ownCourse.id}/lessons/${foreignLesson.id}/complete`,
      )
      .set("Authorization", `Bearer ${signTokenFor(student)}`);

    assert.equal(res.status, 404);

    const reloaded = await Enrollment.findByPk(enrollment.id);
    assert.equal(reloaded.isCompleted, false);
  });
});

describe("H-3: one module quiz does not complete a multi-module course", () => {
  it("leaves the course incomplete while other content is outstanding", async () => {
    const course = await createCourse({ pricingType: "free" });
    const moduleOne = await createModule(course, { order: 1 });
    const moduleTwo = await createModule(course, { order: 2 });
    const quizOne = await createQuiz(moduleOne);
    await createQuiz(moduleTwo);
    await createLesson(moduleOne, { title: "Lesson one" });

    const student = await createUser();
    await createEnrollment(student, course);
    const token = signTokenFor(student);

    const res = await request(app)
      .post(`/api/quizzes/${quizOne.id}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: { q1: 1, q2: 1 } });

    assert.equal(res.status, 201);
    assert.equal(res.body.passed, true);
    assert.equal(
      res.body.courseCompleted,
      false,
      "one quiz out of two, with a lesson outstanding, is not a finished course",
    );
  });
});

describe("H-4: instructors cannot edit each other's content", () => {
  it("refuses a module write on someone else's course", async () => {
    const owner = await createUser({ role: "admin" });
    const intruder = await createUser({ role: "admin" });
    const course = await createCourse({ createdBy: owner.id });

    const res = await request(app)
      .post(`/api/courses/${course.id}/modules`)
      .set("Authorization", `Bearer ${signTokenFor(intruder)}`)
      .send({ title: "Injected module" });

    assert.equal(res.status, 403);
  });

  it("refuses a lesson delete on someone else's course", async () => {
    const owner = await createUser({ role: "admin" });
    const intruder = await createUser({ role: "admin" });
    const course = await createCourse({ createdBy: owner.id });
    const mod = await createModule(course);
    const lesson = await createLesson(mod);

    const res = await request(app)
      .delete(`/api/courses/${course.id}/modules/${mod.id}/lessons/${lesson.id}`)
      .set("Authorization", `Bearer ${signTokenFor(intruder)}`);

    assert.equal(res.status, 403);
  });

  it("lets the owning instructor through", async () => {
    const owner = await createUser({ role: "admin" });
    const course = await createCourse({ createdBy: owner.id });

    const res = await request(app)
      .post(`/api/courses/${course.id}/modules`)
      .set("Authorization", `Bearer ${signTokenFor(owner)}`)
      .send({ title: "Own module" });

    assert.equal(res.status, 201);
  });
});

describe("H-5 / H-7: account state is enforced on every request", () => {
  it("rejects a blocked user at login", async () => {
    const email = "blocked-login@example.com";
    await createUser({ email, password: "password1234", isBlocked: true });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password1234" });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /blocked/i);
  });

  it("rejects an already-issued token once the account is blocked", async () => {
    const user = await createUser();
    const token = signTokenFor(user);

    const before = await request(app)
      .get("/api/profile")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(before.status, 200);

    await user.update({ isBlocked: true });

    const after = await request(app)
      .get("/api/profile")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(after.status, 403);
  });

  it("takes the role from the database, not the token", async () => {
    const user = await createUser({ role: "super-admin" });
    const staleAdminToken = signTokenFor(user);

    await user.update({ role: "user" });

    const res = await request(app)
      .get("/api/superadmin/users")
      .set("Authorization", `Bearer ${staleAdminToken}`);

    assert.equal(res.status, 403);
  });
});

describe("H-8: drafts stay hidden from learners", () => {
  it("omits drafts from the listing for a signed-in learner", async () => {
    await createCourse({ title: "Live one", status: "published" });
    await createCourse({ title: "Secret draft", status: "draft" });
    const learner = await createUser();

    const res = await request(app)
      .get("/api/courses")
      .set("Authorization", `Bearer ${signTokenFor(learner)}`);

    assert.equal(res.status, 200);
    const titles = res.body.map((c) => c.title);
    assert.ok(titles.includes("Live one"));
    assert.ok(!titles.includes("Secret draft"));
  });

  it("404s a draft course detail for a learner", async () => {
    const course = await createCourse({ status: "draft" });
    const learner = await createUser();

    const res = await request(app)
      .get(`/api/courses/${course.id}`)
      .set("Authorization", `Bearer ${signTokenFor(learner)}`);

    assert.equal(res.status, 404);
  });
});

describe("M-4 / M-10: responses and writes are constrained", () => {
  it("ignores unexpected fields on a course update", async () => {
    const owner = await createUser({ role: "admin" });
    const someoneElse = await createUser({ role: "admin" });
    const course = await createCourse({ createdBy: owner.id });

    const res = await request(app)
      .put(`/api/courses/${course.id}`)
      .set("Authorization", `Bearer ${signTokenFor(owner)}`)
      .send({ title: "Renamed", createdBy: someoneElse.id });

    assert.equal(res.status, 200);
    await course.reload();
    assert.equal(course.title, "Renamed");
    assert.equal(course.createdBy, owner.id, "ownership must not be reassignable");
  });
});

describe("M-11: one password policy everywhere", () => {
  it("rejects a short password at registration", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Shorty", email: "shorty@example.com", password: "abc123" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 8 characters/i);
  });

  it("does not overwrite a pending account's password on re-registration", async () => {
    const email = "pending-signup@example.com";
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Pending", email, password: "originalpassword" });

    const before = await User.findOne({ where: { email } });

    await request(app)
      .post("/api/auth/register")
      .send({ name: "Attacker", email, password: "attackerpassword" });

    const after = await User.findOne({ where: { email } });
    assert.equal(after.password, before.password, "the stored hash must be unchanged");
    assert.equal(after.name, "Pending", "the name must be unchanged too");
  });
});
