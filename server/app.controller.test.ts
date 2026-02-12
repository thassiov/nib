import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createTestApp } from "./__tests__/helpers.js";

describe("Health endpoint", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined as any;
    }
  });

  it("GET /api/health returns connected status", async () => {
    app = await createTestApp();

    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      service: "nib",
      db: "connected",
    });
  });
});
