import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { requireAuth, optionalAuth } from "./middleware.js";

function createTestApp() {
  const app = express();
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Route that injects session data for testing
  app.get("/set-session", (req, res) => {
    req.session.userId = "user-123";
    req.session.save(() => res.json({ ok: true }));
  });

  // Protected route
  app.get("/protected", requireAuth, (_req, res) => {
    res.json({ ok: true });
  });

  // Optional auth route
  app.get("/optional", optionalAuth, (req, res) => {
    res.json({ userId: req.session.userId || null });
  });

  return app;
}

describe("requireAuth middleware", () => {
  it("returns 401 when not authenticated", async () => {
    const app = createTestApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authentication required/);
  });

  it("passes through when authenticated", async () => {
    const app = createTestApp();
    const agent = request.agent(app);

    // Set up session first
    await agent.get("/set-session");

    const res = await agent.get("/protected");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("optionalAuth middleware", () => {
  it("passes through without auth", async () => {
    const app = createTestApp();
    const res = await request(app).get("/optional");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });

  it("passes through with auth, exposing session data", async () => {
    const app = createTestApp();
    const agent = request.agent(app);

    await agent.get("/set-session");

    const res = await agent.get("/optional");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-123");
  });
});
