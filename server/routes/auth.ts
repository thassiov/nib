import { Router, Request, Response } from "express";
import { buildLoginUrl, handleCallback, buildLogoutUrl } from "../auth/oidc.js";
import { User } from "../db.js";

const router = Router();

/**
 * GET /auth/login
 * Redirects the user to Authelia's authorization endpoint.
 * Stores PKCE verifier and state in session.
 */
router.get("/login", async (req: Request, res: Response) => {
  try {
    const { url, code_verifier, state } = await buildLoginUrl();

    // Store PKCE verifier and state in session for the callback
    req.session.code_verifier = code_verifier;
    req.session.oidc_state = state;

    // Save session before redirect to ensure values are persisted
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect(url.href);
    });
  } catch (err) {
    console.error("OIDC login error:", err);
    res.status(500).json({ error: "Failed to initiate login" });
  }
});

/**
 * GET /auth/callback
 * Handles the OIDC callback from Authelia.
 * Exchanges the authorization code for tokens, fetches user info,
 * creates/updates the user in the DB, and sets session.
 */
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const code_verifier = req.session.code_verifier;
    const expectedState = req.session.oidc_state;

    if (!code_verifier || !expectedState) {
      res.status(400).json({ error: "Missing OIDC session data. Please try logging in again." });
      return;
    }

    // Build the full callback URL from the request
    const callbackUrl = new URL(
      req.originalUrl,
      `${req.protocol}://${req.get("host")}`,
    );

    const { userInfo, idToken } = await handleCallback(callbackUrl, code_verifier, expectedState);

    // Clean up transient session data
    delete req.session.code_verifier;
    delete req.session.oidc_state;

    // Upsert user in database
    const username = userInfo.preferred_username || userInfo.name || userInfo.sub;
    const [user] = await User.upsert({
      sub: userInfo.sub,
      username,
      email: userInfo.email || null,
      avatar_url: userInfo.picture || null,
    });

    // Set session
    req.session.userId = user.id;
    req.session.sub = userInfo.sub;
    req.session.username = username;
    req.session.idToken = idToken;

    // Save and redirect to home
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect("/");
    });
  } catch (err) {
    console.error("OIDC callback error:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
});

/**
 * GET /auth/logout
 * Clears the session and redirects to Authelia's end-session endpoint.
 */
router.get("/logout", async (req: Request, res: Response) => {
  try {
    const idToken = req.session.idToken;

    // Destroy session
    req.session.destroy(async (err) => {
      if (err) {
        console.error("Session destroy error:", err);
      }

      try {
        const logoutUrl = await buildLogoutUrl(idToken);
        res.redirect(logoutUrl.href);
      } catch {
        // If we can't build the logout URL, just redirect home
        res.redirect("/");
      }
    });
  } catch (err) {
    console.error("Logout error:", err);
    res.redirect("/");
  }
});

/**
 * GET /auth/me
 * Returns the current user's info, or 401 if not authenticated.
 */
router.get("/me", (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.json({
    id: req.session.userId,
    sub: req.session.sub,
    username: req.session.username,
  });
});

export default router;
