import jwt from "jsonwebtoken";

export function protect(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "super-admin")
    return res.status(403).json({ error: "Admins only" });
  next();
}

export function superAdminOnly(req, res, next) {
  if (req.user?.role !== "super-admin")
    return res.status(403).json({ error: "Super admins only" });
  next();
}
