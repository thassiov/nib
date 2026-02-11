import { describe, it, expect } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createTestApp, createAuthenticatedTestApp } from "../../__tests__/helpers.js";

describe("AuthGuard", () => {
  let app: INestApplication;

  it("returns 403 when not authenticated (guarded route)", async () => {
    app = await createTestApp();
    const server = app.getHttpServer();
    const res = await request(server).get("/api/scenes/my");
    expect(res.status).toBe(403);
    await app.close();
  });

  it("passes through when authenticated", async () => {
    const userId = "test-user-id-123";
    app = await createAuthenticatedTestApp({ userId });
    const server = app.getHttpServer();
    // /api/scenes/my requires auth - it will pass the guard but might return empty results
    const res = await request(server).get("/api/scenes/my");
    expect(res.status).toBe(200);
    await app.close();
  });
});

describe("OptionalAuthGuard", () => {
  let app: INestApplication;

  it("allows anonymous access to public scenes", async () => {
    app = await createTestApp();
    const server = app.getHttpServer();
    const res = await request(server).get("/api/scenes");
    expect(res.status).toBe(200);
    await app.close();
  });
});
