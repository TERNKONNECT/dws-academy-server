import { before, after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import request from "supertest";
import * as realEmail from "../config/email.js";

// Never send real email during tests — capture the OTP straight from the template
// call (not by scraping the rendered HTML, which also contains 6-digit-looking CSS
// hex colors like #111111). Other consumers (e.g. routes/superadmin.js) import
// unrelated exports from this same module, so pass those through unchanged.
let lastOtp = null;
mock.module("../config/email.js", {
  namedExports: {
    ...realEmail,
    verificationEmailTemplate: (args) => {
      lastOtp = args.otp;
      return realEmail.verificationEmailTemplate(args);
    },
    sendEmail: async () => ({ skipped: true }),
  },
});

const { setupTestDb, closeTestDb, app } = await import("./helpers/db.js");
const { createUser } = await import("./helpers/factories.js");
const User = (await import("../models/User.js")).default;

const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("Onboarding: registration, email verification, login", () => {
  const email = "onboarding-user@example.com";
  const password = "supersecret123";

  it("registers a new user and sends a verification code (unverified, no token yet)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "New Learner", email, password });

    assert.equal(res.status, 201);
    assert.match(res.body.message, /verification code/i);

    const user = await User.findOne({ where: { email } });
    assert.ok(user, "user should be created");
    assert.equal(user.emailVerified, false);
    assert.ok(user.emailVerificationToken, "otp hash should be stored");
    assert.ok(lastOtp, "an otp should have been captured from the email");
  });

  it("rejects login before the account is verified", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "EMAIL_NOT_VERIFIED");
  });

  it("rejects verification with a wrong code", async () => {
    const res = await request(app)
      .post("/api/auth/verify-email")
      .send({ email, otp: "000000" });
    assert.equal(res.status, 400);
  });

  it("verifies the account with the correct code and allows login afterward", async () => {
    const verifyRes = await request(app)
      .post("/api/auth/verify-email")
      .send({ email, otp: lastOtp });
    assert.equal(verifyRes.status, 200);

    const user = await User.findOne({ where: { email } });
    assert.equal(user.emailVerified, true);
    assert.equal(user.emailVerificationToken, null);

    const loginRes = await request(app).post("/api/auth/login").send({ email, password });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.body.token);
    assert.equal(loginRes.body.user.email, email);
  });

  it("rejects login with the wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    assert.equal(res.status, 401);
  });

  it("rejects registering a second account with an already-verified email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Duplicate", email, password: "another-password" });
    assert.equal(res.status, 400);
  });

  it("resend-verification silently no-ops for an already-verified email (anti-enumeration)", async () => {
    const before = await User.findOne({ where: { email } });
    const res = await request(app).post("/api/auth/resend-verification").send({ email });
    assert.equal(res.status, 200);
    const after = await User.findOne({ where: { email } });
    assert.equal(after.emailVerificationToken, before.emailVerificationToken);
  });

  it("resend-verification issues a fresh code for an unverified account", async () => {
    const pendingEmail = "resend-target@example.com";
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Pending", email: pendingEmail, password: "password123" });
    const firstOtp = lastOtp;

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: pendingEmail });
    assert.equal(res.status, 200);
    assert.notEqual(lastOtp, firstOtp, "a new otp should have been generated");

    const verifyRes = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: pendingEmail, otp: lastOtp });
    assert.equal(verifyRes.status, 200);
  });

  it("returns the same generic response for resend-verification on a non-existent email", async () => {
    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "nobody-here@example.com" });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /if an account/i);
  });

  it("rejects an expired verification code", async () => {
    const expiredEmail = "expired-otp@example.com";
    const user = await createUser({
      email: expiredEmail,
      emailVerified: false,
      emailVerificationToken: hashValue("111111"),
      emailVerificationExpires: new Date(Date.now() - 60 * 1000), // already expired
    });

    const res = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: expiredEmail, otp: "111111" });
    assert.equal(res.status, 400);

    const stillUnverified = await User.findByPk(user.id);
    assert.equal(stillUnverified.emailVerified, false);
  });

  it("blocks a deactivated account from logging in", async () => {
    const deactivatedEmail = "deactivated@example.com";
    await createUser({
      email: deactivatedEmail,
      password: "password123",
      emailVerified: true,
      deactivatedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: deactivatedEmail, password: "password123" });
    assert.equal(res.status, 403);
  });
});
