import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { UsersService } from "../users/users.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(UsersService) private readonly usersService: UsersService,
  ) {}

  /**
   * GET /auth/login
   * Redirects the user to Authelia's authorization endpoint.
   */
  @Get("login")
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const { url, code_verifier, state } = await this.authService.buildLoginUrl();
      const session = req.session as any;

      session.code_verifier = code_verifier;
      session.oidc_state = state;

      session.save((err: Error | null) => {
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
  }

  /**
   * GET /auth/callback
   * Handles the OIDC callback from Authelia.
   */
  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const session = req.session as any;
      const code_verifier = session.code_verifier;
      const expectedState = session.oidc_state;

      if (!code_verifier || !expectedState) {
        res.status(400).json({ error: "Missing OIDC session data. Please try logging in again." });
        return;
      }

      const callbackUrl = new URL(
        req.originalUrl,
        `${req.protocol}://${req.get("host")}`,
      );

      const { userInfo, idToken } = await this.authService.handleCallback(
        callbackUrl,
        code_verifier,
        expectedState,
      );

      // Clean up transient session data
      delete session.code_verifier;
      delete session.oidc_state;

      // Upsert user in database
      const username = userInfo.preferred_username || userInfo.name || userInfo.sub;
      const adminSubs = (process.env.ADMIN_SUBS || "").split(",").map((s) => s.trim()).filter(Boolean);
      const role = adminSubs.includes(userInfo.sub) ? "admin" : "user";
      const user = await this.usersService.upsert({
        sub: userInfo.sub,
        username,
        email: userInfo.email || null,
        avatar_url: userInfo.picture || null,
        role,
      });

      // Set session
      session.userId = user.id;
      session.sub = userInfo.sub;
      session.username = username;
      session.role = user.role;
      session.idToken = idToken;

      session.save((err: Error | null) => {
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
  }

  /**
   * GET /auth/logout
   * Clears the session and redirects to Authelia's end-session endpoint.
   */
  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const session = req.session as any;
      const idToken = session.idToken;

      session.destroy(async (err: Error | null) => {
        if (err) {
          console.error("Session destroy error:", err);
        }

        try {
          const logoutUrl = await this.authService.buildLogoutUrl(idToken);
          res.redirect(logoutUrl.href);
        } catch {
          res.redirect("/");
        }
      });
    } catch (err) {
      console.error("Logout error:", err);
      res.redirect("/");
    }
  }

  /**
   * GET /auth/me
   * Returns the current user's info, or 401 if not authenticated.
   */
  @Get("me")
  me(@Req() req: Request, @Res() res: Response): void {
    const session = req.session as any;

    if (!session.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    res.json({
      id: session.userId,
      sub: session.sub,
      username: session.username,
      role: session.role || "user",
    });
  }
}
