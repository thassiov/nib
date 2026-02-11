/**
 * Shared test helpers: Express app factory, fixtures, session helpers.
 */
import express from "express";
import session from "express-session";
import scenesRouter from "../routes/scenes.js";
import authRouter from "../routes/auth.js";

/**
 * Creates a fresh Express app for testing (same middleware as production).
 */
export function createApp() {
  const app = express();

  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      name: "nib.sid",
    }),
  );

  app.use(express.json({ limit: "50mb" }));
  app.use("/auth", authRouter);
  app.use("/api/scenes", scenesRouter);

  return app;
}

/**
 * Middleware that injects a fake authenticated session for testing.
 * Use: app.use(fakeAuth({ userId: "...", sub: "...", username: "..." }))
 */
export function fakeAuth(sessionData: { userId: string; sub?: string; username?: string }) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.session.userId = sessionData.userId;
    req.session.sub = sessionData.sub || "test-sub";
    req.session.username = sessionData.username || "testuser";
    next();
  };
}

/**
 * Creates an Express app with a pre-authenticated session.
 */
export function createAuthenticatedApp(sessionData: { userId: string; sub?: string; username?: string }) {
  const app = express();

  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      name: "nib.sid",
    }),
  );

  app.use(express.json({ limit: "50mb" }));
  app.use(fakeAuth(sessionData));
  app.use("/auth", authRouter);
  app.use("/api/scenes", scenesRouter);

  return app;
}

/** Minimal valid Excalidraw scene for testing */
export const VALID_SCENE = {
  elements: [
    {
      id: "rect1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    },
  ],
  appState: {},
  files: {},
};

/** Scene with a text element */
export const VALID_TEXT_SCENE = {
  elements: [
    {
      id: "text1",
      type: "text",
      x: 10,
      y: 10,
      width: 200,
      height: 24,
      text: "Hello",
      fontSize: 20,
    },
  ],
  appState: {},
  files: {},
};
