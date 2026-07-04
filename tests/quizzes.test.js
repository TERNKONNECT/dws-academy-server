import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, closeTestDb, app } from "./helpers/db.js";
import {
  createUser,
  createCourse,
  createModule,
  createQuiz,
  createEnrollment,
  signTokenFor,
} from "./helpers/factories.js";

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

async function setupEnrolledQuiz() {
  const user = await createUser();
  const course = await createCourse({ pricingType: "free" });
  const mod = await createModule(course);
  const quiz = await createQuiz(mod);
  await createEnrollment(user, course);
  return { user, course, mod, quiz, token: signTokenFor(user) };
}

describe("Quiz: fetching and submitting", () => {
  it("lets an enrolled student fetch the quiz", async () => {
    const { quiz, token } = await setupEnrolledQuiz();
    const res = await request(app)
      .get(`/api/quizzes/${quiz.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.questions.length, 2);
  });

  it("blocks a non-enrolled user from fetching the quiz", async () => {
    const { quiz } = await setupEnrolledQuiz();
    const outsider = await createUser();
    const res = await request(app)
      .get(`/api/quizzes/${quiz.id}`)
      .set("Authorization", `Bearer ${signTokenFor(outsider)}`);
    assert.equal(res.status, 403);
  });

  it("grades a perfect submission as passed", async () => {
    const { quiz, token } = await setupEnrolledQuiz();
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: { q1: 1, q2: 1 } });

    assert.equal(res.status, 201);
    assert.equal(res.body.score, 2);
    assert.equal(res.body.totalQuestions, 2);
    assert.equal(res.body.percentage, 100);
    assert.equal(res.body.passed, true);
  });

  it("grades a failing submission (below 80%) as not passed and does not complete the course", async () => {
    const { quiz, course, user, token } = await setupEnrolledQuiz();
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: { q1: 0, q2: 1 } }); // 1 of 2 correct = 50%

    assert.equal(res.status, 201);
    assert.equal(res.body.score, 1);
    assert.equal(res.body.percentage, 50);
    assert.equal(res.body.passed, false);

    const progress = await request(app)
      .get(`/api/enrollments/${course.id}/progress`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(progress.body.isCompleted, false);
  });

  it("marks the enrollment completed when the quiz is passed", async () => {
    const { quiz, course, token } = await setupEnrolledQuiz();
    await request(app)
      .post(`/api/quizzes/${quiz.id}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: { q1: 1, q2: 1 } });

    const progress = await request(app)
      .get(`/api/enrollments/${course.id}/progress`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(progress.body.isCompleted, true);
  });

  it("rejects a quiz submission from a user who isn't enrolled", async () => {
    const { quiz } = await setupEnrolledQuiz();
    const outsider = await createUser();
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/submit`)
      .set("Authorization", `Bearer ${signTokenFor(outsider)}`)
      .send({ answers: { q1: 1, q2: 1 } });
    assert.equal(res.status, 403);
  });

  it("lets an admin preview a quiz submission without persisting an attempt", async () => {
    const { quiz } = await setupEnrolledQuiz();
    const admin = await createUser({ role: "admin", emailVerified: true });
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/submit`)
      .set("Authorization", `Bearer ${signTokenFor(admin)}`)
      .send({ answers: { q1: 1, q2: 1 } });

    assert.equal(res.status, 200);
    assert.equal(res.body.preview, true);
    assert.equal(res.body.passed, true);
  });
});
