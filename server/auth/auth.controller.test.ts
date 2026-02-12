import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createTestApp, createAuthenticatedTestApp } from "../__tests__/helpers.js";

describe("Auth endpoints", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined as any;
    }
  });

  describe("GET /auth/me", () => {
    it("returns 401 when not authenticated", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer()).get("/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/not authenticated/i);
    });

    it("returns user info when authenticated", async () => {
      const userId = "a0000000-0000-0000-0000-000000000001";
      app = await createAuthenticatedTestApp({
        userId,
        sub: "oidc-sub-1",
        username: "alice",
      });

      const res = await request(app.getHttpServer()).get("/auth/me");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: userId,
        sub: "oidc-sub-1",
        username: "alice",
      });
    });
  });
});
