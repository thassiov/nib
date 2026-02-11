import { Request, Response, NextFunction } from "express";

/**
 * Express middleware that requires an authenticated session.
 * Returns 401 if the user is not logged in.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Express middleware that attaches user info if available but doesn't block.
 * Useful for routes that behave differently for authenticated vs anonymous users
 * (e.g. scene detail: owner sees private scenes, anonymous only sees public).
 */
export function optionalAuth(_req: Request, _res: Response, next: NextFunction): void {
  // Session data is already available via req.session if the user is logged in.
  // This middleware is a no-op but serves as documentation in route definitions.
  next();
}
