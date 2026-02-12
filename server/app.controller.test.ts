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
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("nib");
    expect(res.body.db).toBe("connected");
    // oidc will be "unreachable" in tests (no Authelia running)
    expect(res.body.oidc).toBe("unreachable");
  });
});
