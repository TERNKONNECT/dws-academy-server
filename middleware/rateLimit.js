/**
 * Fixed-window rate limiter, in memory, no dependency.
 *
 * Caveat worth knowing: on Lambda/Vercel each warm instance keeps its own counter,
 * so the effective limit is (limit × instances). That still blunts credential
 * stuffing and mail flooding by orders of magnitude, but it is not the whole defence
 * for one-time codes — those also carry a per-account attempt counter in the
 * database (see `otpAttempts` on the User model), which no amount of horizontal
 * scaling can dodge.
 *
 * Swap the store for Redis if the platform ever gets one.
 */

const buckets = new Map();
let lastSweep = Date.now();

function sweep(now) {
  // Cheap amortised cleanup so the map can't grow without bound.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * @param {object}   options
 * @param {number}   options.windowMs  Length of the window.
 * @param {number}   options.limit     Requests allowed per key per window.
 * @param {string}   options.name      Namespace, so two limiters don't share buckets.
 * @param {function} [options.keyOn]   Extra key material, e.g. the submitted email.
 * @param {string}   [options.message] Response body when the limit is hit.
 */
export function rateLimit({ windowMs, limit, name, keyOn, message }) {
  return function rateLimiter(req, res, next) {
    // Tests exercise these endpoints in tight loops; limiting there only adds flake.
    if (process.env.NODE_ENV === "test") return next();

    const now = Date.now();
    sweep(now);

    const extra = keyOn ? String(keyOn(req) ?? "") : "";
    const key = `${name}:${clientIp(req)}:${extra.toLowerCase()}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error:
          message || `Too many requests. Try again in ${retryAfter} seconds.`,
      });
    }

    next();
  };
}

/** Sign-in and other credential checks: slow down guessing without locking people out. */
export const loginLimiter = rateLimit({
  name: "login",
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyOn: (req) => req.body?.email,
  message: "Too many sign-in attempts. Try again in a few minutes.",
});

/** Anything that sends mail — protects the Resend quota and the sending domain. */
export const emailLimiter = rateLimit({
  name: "email",
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyOn: (req) => req.body?.email,
  message: "Too many requests for this email. Try again later.",
});

/** One-time-code submission. The per-account counter is the real lock; this is the outer wall. */
export const otpLimiter = rateLimit({
  name: "otp",
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyOn: (req) => req.body?.email,
  message: "Too many code attempts. Request a new code and try again.",
});

/** Blunt default for the rest of the API. */
export const apiLimiter = rateLimit({
  name: "api",
  windowMs: 60 * 1000,
  limit: 300,
});
