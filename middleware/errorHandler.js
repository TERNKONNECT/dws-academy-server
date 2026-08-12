import crypto from "crypto";

/**
 * Wraps an async route handler so a rejected promise reaches the error handler
 * instead of hanging the request. Lets routes drop their boilerplate try/catch.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Sequelize errors carry column names, constraint names, and sometimes SQL. Those
 * used to go straight to the browser as `err.message`. Now the detail is logged and
 * the caller gets a reference id they can quote in a support request.
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const reference = crypto.randomBytes(6).toString("hex");

  if (status >= 500) {
    console.error(
      JSON.stringify({
        scope: "error",
        reference,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id,
        message: err?.message,
        stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
      }),
    );
  }

  // 4xx messages are written by us for the caller, so they are safe to pass through.
  if (status < 500) {
    return res.status(status).json({ error: err.message || "Request failed" });
  }

  res.status(500).json({
    error: "Something went wrong. Quote this reference if you contact support.",
    reference,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
}

/**
 * Small helper for throwing a status-carrying error from inside a handler.
 */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
