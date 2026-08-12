import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Roles that may reach the admin dashboard at all.
const ADMIN_ROLES = new Set(["admin", "super-admin", "operator"]);
// Roles that may manage content and other people (operators are read-only staff).
const STRICT_ADMIN_ROLES = new Set(["admin", "super-admin"]);

/**
 * Verifies the bearer token AND re-reads the user from the database.
 *
 * The token is only a claim about who the caller was when it was issued. Blocking,
 * deactivating, or demoting someone has to take effect immediately, so role and
 * account status are always taken from the row, never from the payload.
 */
export async function protect(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Session expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const user = await User.findByPk(payload.id, {
      attributes: [
        "id",
        "email",
        "role",
        "isBlocked",
        "deactivatedAt",
        "passwordSetupRequired",
      ],
    });

    if (!user) return res.status(401).json({ error: "Account no longer exists" });
    if (user.isBlocked)
      return res.status(403).json({ error: "This account has been blocked." });
    if (user.deactivatedAt)
      return res.status(403).json({ error: "This account has been deactivated." });

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Same as `protect` but tolerates an absent or invalid token: `req.user` is either
 * populated or left undefined. Used by public reads that show more to a signed-in
 * caller (course listings, course detail).
 */
export async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(payload.id, {
      attributes: ["id", "email", "role", "isBlocked", "deactivatedAt"],
    });
    if (user && !user.isBlocked && !user.deactivatedAt) {
      req.user = { id: user.id, email: user.email, role: user.role };
    }
  } catch {
    // An unreadable token is treated exactly like no token at all.
  }
  next();
}

export function adminOnly(req, res, next) {
  if (!ADMIN_ROLES.has(req.user?.role))
    return res.status(403).json({ error: "Admins only" });
  next();
}

export function strictAdminOnly(req, res, next) {
  if (!STRICT_ADMIN_ROLES.has(req.user?.role))
    return res.status(403).json({ error: "Strict admins only" });
  next();
}

export function superAdminOnly(req, res, next) {
  if (req.user?.role !== "super-admin")
    return res.status(403).json({ error: "Super admins only" });
  next();
}
