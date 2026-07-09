import { before, after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import request from "supertest";
import * as realEmail from "../config/email.js";

// Never send real receipt emails, and never call the real Paystack API — each test
// controls what "Paystack" returns via the mutable results below.
mock.module("../config/email.js", {
  namedExports: {
    ...realEmail,
    sendEmail: async () => ({ skipped: true }),
  },
});

let nextInitializeResult = null;
let nextVerifyResult = null;
let lastVerifyReference = null;

// node:test's mock.module() can only be called once per specifier, so tests that need
// custom per-reference verify behavior (e.g. bulk-verify) swap this function out instead
// of re-mocking the module, then restore it via resetVerifyImpl().
let verifyImpl = async (reference) => {
  lastVerifyReference = reference;
  return nextVerifyResult;
};
function resetVerifyImpl() {
  verifyImpl = async (reference) => {
    lastVerifyReference = reference;
    return nextVerifyResult;
  };
}

mock.module("../config/paystack.js", {
  namedExports: {
    getPaystackSecretKey: () => process.env.PAYSTACK_SECRET_KEY,
    initializePaystackTransaction: async () => nextInitializeResult,
    verifyPaystackTransaction: async (reference) => verifyImpl(reference),
  },
});

const { setupTestDb, closeTestDb, app } = await import("./helpers/db.js");
const {
  createUser,
  createCourse,
  createPayment,
  signTokenFor,
} = await import("./helpers/factories.js");
const Payment = (await import("../models/Payment.js")).default;
const Enrollment = (await import("../models/Enrollment.js")).default;

const toKobo = (amount) => Math.round(Number(amount) * 100);

before(async () => {
  await setupTestDb();
});

after(async () => {
  await closeTestDb();
});

describe("Payments: initialize a paid-course checkout", () => {
  it("initializes a Paystack transaction and creates a pending payment", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 10000 });
    nextInitializeResult = {
      reference: "paystack-ref-ignored",
      access_code: "access_code_123",
      authorization_url: "https://checkout.paystack.com/abc123",
    };

    const res = await request(app)
      .post("/api/payments/initialize")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 201);
    assert.equal(res.body.amount, 10500); // 10000 + 5% service fee
    assert.equal(res.body.authorizationUrl, "https://checkout.paystack.com/abc123");

    const payment = await Payment.findOne({ where: { reference: res.body.reference } });
    assert.ok(payment, "a payment row should have been created");
    assert.equal(payment.status, "pending");
    assert.equal(Number(payment.amount), 10500);
  });

  it("rejects initializing payment for a free course", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "free" });

    const res = await request(app)
      .post("/api/payments/initialize")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /free/i);
  });

  it("rejects initializing payment for an unpublished course", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000, status: "draft" });

    const res = await request(app)
      .post("/api/payments/initialize")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /not available/i);
  });

  it("rejects initializing payment when the user is already enrolled", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    await Enrollment.create({ userId: user.id, courseId: course.id });

    const res = await request(app)
      .post("/api/payments/initialize")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already have access/i);
  });

  it("rejects initializing a second payment once one has already succeeded", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    await createPayment(user, course, { status: "success" });

    const res = await request(app)
      .post("/api/payments/initialize")
      .set("Authorization", `Bearer ${signTokenFor(user)}`)
      .send({ courseId: course.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already completed/i);
  });

  it("requires authentication", async () => {
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const res = await request(app).post("/api/payments/initialize").send({ courseId: course.id });
    assert.equal(res.status, 401);
  });
});

describe("Payments: student self-verify", () => {
  it("grants course access when Paystack confirms success", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(user, course, { amount: 5000, currency: "NGN" });

    nextVerifyResult = {
      status: "success",
      reference: payment.reference,
      amount: toKobo(5000),
      currency: "NGN",
      channel: "card",
      gateway_response: "Successful",
      id: 999111,
      paid_at: new Date().toISOString(),
      metadata: {},
    };

    const res = await request(app)
      .get(`/api/payments/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "success");
    assert.equal(lastVerifyReference, payment.reference);

    const updated = await Payment.findByPk(payment.id);
    assert.equal(updated.status, "success");

    const enrollment = await Enrollment.findOne({
      where: { userId: user.id, courseId: course.id },
    });
    assert.ok(enrollment, "enrollment should have been created");
  });

  it("leaves the payment pending when Paystack says it's still processing", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(user, course, { amount: 5000 });

    nextVerifyResult = { status: "pending", reference: payment.reference, amount: toKobo(5000) };

    const res = await request(app)
      .get(`/api/payments/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);

    assert.equal(res.status, 202);
    const updated = await Payment.findByPk(payment.id);
    assert.equal(updated.status, "pending");

    const enrollment = await Enrollment.findOne({
      where: { userId: user.id, courseId: course.id },
    });
    assert.equal(enrollment, null);
  });

  it("marks the payment failed when Paystack reports abandonment", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(user, course, { amount: 5000 });

    nextVerifyResult = { status: "abandoned", reference: payment.reference, amount: toKobo(5000) };

    const res = await request(app)
      .get(`/api/payments/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);

    assert.equal(res.status, 400);
    const updated = await Payment.findByPk(payment.id);
    assert.equal(updated.status, "abandoned");
  });

  it("rejects (500) when Paystack reports success but the amount paid is short", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(user, course, { amount: 5000 });

    nextVerifyResult = {
      status: "success",
      reference: payment.reference,
      amount: toKobo(1000), // way under the expected 5000
      currency: "NGN",
      metadata: {},
    };

    const res = await request(app)
      .get(`/api/payments/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(user)}`);

    assert.equal(res.status, 500);
    assert.match(res.body.error, /amount too low/i);

    const updated = await Payment.findByPk(payment.id);
    assert.equal(updated.status, "pending", "status should not have been upgraded to success");
  });

  it("403s when the payment reference does not belong to the requesting user", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(owner, course);

    const res = await request(app)
      .get(`/api/payments/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(outsider)}`);

    assert.equal(res.status, 403);
    assert.match(res.body.error, /belongs to a different user/i);
  });
});

describe("Payments: admin pending list and verify", () => {
  it("lists only pending payments for a course the admin owns", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({ pricingType: "paid", price: 5000, createdBy: admin.id });
    const student = await createUser();
    await createPayment(student, course, { status: "pending" });
    await createPayment(student, course, { status: "success" });

    const res = await request(app)
      .get(`/api/payments/admin/courses/${course.id}/pending`)
      .set("Authorization", `Bearer ${signTokenFor(admin)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  it("rejects an admin viewing pending payments for a course they don't own", async () => {
    const owner = await createUser({ role: "admin", emailVerified: true });
    const otherAdmin = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({ pricingType: "paid", price: 5000, createdBy: owner.id });

    const res = await request(app)
      .get(`/api/payments/admin/courses/${course.id}/pending`)
      .set("Authorization", `Bearer ${signTokenFor(otherAdmin)}`);

    assert.equal(res.status, 403);
  });

  it("lets a super-admin verify any pending payment regardless of course ownership", async () => {
    const superAdmin = await createUser({ role: "super-admin", emailVerified: true });
    const instructor = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({
      pricingType: "paid",
      price: 5000,
      createdBy: instructor.id,
    });
    const student = await createUser();
    const payment = await createPayment(student, course, { amount: 5000 });

    nextVerifyResult = {
      status: "success",
      reference: payment.reference,
      amount: toKobo(5000),
      currency: "NGN",
      metadata: {},
    };

    const res = await request(app)
      .post(`/api/payments/admin/verify/${payment.reference}`)
      .set("Authorization", `Bearer ${signTokenFor(superAdmin)}`);

    assert.equal(res.status, 200);
    const enrollment = await Enrollment.findOne({
      where: { userId: student.id, courseId: course.id },
    });
    assert.ok(enrollment);
  });
});

describe("Payments: admin bulk verify", () => {
  it("processes all pending payments for the admin's course and reports a summary", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({ pricingType: "paid", price: 5000, createdBy: admin.id });
    const studentA = await createUser();
    const studentB = await createUser();
    const paymentA = await createPayment(studentA, course, { amount: 5000 });
    const paymentB = await createPayment(studentB, course, { amount: 5000 });

    let call = 0;
    verifyImpl = async (reference) => {
      call += 1;
      // First payment succeeds, second is still pending on Paystack's side.
      if (reference === paymentA.reference) {
        return {
          status: "success",
          reference,
          amount: toKobo(5000),
          currency: "NGN",
          metadata: {},
        };
      }
      return { status: "pending", reference, amount: toKobo(5000) };
    };

    try {
      const res = await request(app)
        .post("/api/payments/admin/verify-bulk")
        .set("Authorization", `Bearer ${signTokenFor(admin)}`)
        .send({ courseId: course.id });

      assert.equal(res.status, 200);
      assert.equal(res.body.processed, 2);
      assert.equal(res.body.summary.success, 1);
      assert.equal(res.body.summary.pending, 1);
      assert.ok(call >= 2);

      const updatedA = await Payment.findByPk(paymentA.id);
      const updatedB = await Payment.findByPk(paymentB.id);
      assert.equal(updatedA.status, "success");
      assert.equal(updatedB.status, "pending");
    } finally {
      resetVerifyImpl();
    }
  });
});

describe("Payments: admin ledger and revenue", () => {
  it("filters the payment ledger by status and scopes results to the admin's own courses", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const otherAdmin = await createUser({ role: "admin", emailVerified: true });
    const myCourse = await createCourse({ pricingType: "paid", price: 5000, createdBy: admin.id });
    const otherCourse = await createCourse({
      pricingType: "paid",
      price: 5000,
      createdBy: otherAdmin.id,
    });
    const student = await createUser();
    await createPayment(student, myCourse, { status: "success" });
    await createPayment(student, myCourse, { status: "pending" });
    await createPayment(student, otherCourse, { status: "success" });

    const res = await request(app)
      .get("/api/payments/admin/all")
      .query({ status: "success" })
      .set("Authorization", `Bearer ${signTokenFor(admin)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.payments[0].course.id, myCourse.id);
  });

  it("computes total and current-month revenue from successful payments only", async () => {
    const admin = await createUser({ role: "admin", emailVerified: true });
    const course = await createCourse({ pricingType: "paid", price: 5000, createdBy: admin.id });
    const student = await createUser();
    await createPayment(student, course, {
      status: "success",
      amount: 5000,
      paidAt: new Date(),
    });
    await createPayment(student, course, { status: "pending", amount: 5000 });

    const res = await request(app)
      .get("/api/payments/admin/revenue")
      .set("Authorization", `Bearer ${signTokenFor(admin)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalRevenue, 5000);
    assert.equal(res.body.currentMonthRevenue, 5000);
    assert.equal(res.body.statusBreakdown.success, 1);
    assert.equal(res.body.statusBreakdown.pending, 1);
  });
});

describe("Payments: webhook", () => {
  function signWebhookBody(body) {
    return crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(body))
      .digest("hex");
  }

  it("rejects a webhook call with an invalid signature", async () => {
    const res = await request(app)
      .post("/api/payments/webhook")
      .set("X-Paystack-Signature", "not-the-real-signature")
      .send({ event: "charge.success", data: { reference: "whatever" } });

    assert.equal(res.status, 401);
  });

  it("grants course access on a validly-signed charge.success event", async () => {
    const user = await createUser();
    const course = await createCourse({ pricingType: "paid", price: 5000 });
    const payment = await createPayment(user, course, { amount: 5000 });

    nextVerifyResult = {
      status: "success",
      reference: payment.reference,
      amount: toKobo(5000),
      currency: "NGN",
      metadata: {},
    };

    const body = { event: "charge.success", data: { reference: payment.reference, id: 42 } };
    const signature = signWebhookBody(body);

    const res = await request(app)
      .post("/api/payments/webhook")
      .set("X-Paystack-Signature", signature)
      .send(body);

    assert.equal(res.status, 200);
    const updated = await Payment.findByPk(payment.id);
    assert.equal(updated.status, "success");

    const enrollment = await Enrollment.findOne({
      where: { userId: user.id, courseId: course.id },
    });
    assert.ok(enrollment);
  });

  it("ignores unrelated event types without error", async () => {
    const body = { event: "transfer.success", data: { reference: "irrelevant" } };
    const signature = signWebhookBody(body);

    const res = await request(app)
      .post("/api/payments/webhook")
      .set("X-Paystack-Signature", signature)
      .send(body);

    assert.equal(res.status, 200);
  });
});
