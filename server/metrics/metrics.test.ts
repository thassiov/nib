import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createTestApp, createAuthenticatedTestApp, VALID_SCENE } from "../__tests__/helpers.js";

describe("Metrics endpoint", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined as any;
    }
  });

  it("GET /metrics returns Prometheus text format", async () => {
    app = await createTestApp();

    const res = await request(app.getHttpServer()).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain|application\/openmetrics-text/);

    // Should contain our custom metrics
    expect(res.text).toContain("nib_drawings_total");
    expect(res.text).toContain("nib_users_total");
    expect(res.text).toContain("nib_drawings_created_total");
    expect(res.text).toContain("nib_drawings_deleted_total");
  });

  it("reports default Node.js process metrics", async () => {
    app = await createTestApp();

    const res = await request(app.getHttpServer()).get("/metrics");
    expect(res.status).toBe(200);
    // prom-client default metrics include process_cpu_seconds_total
    expect(res.text).toContain("process_cpu_seconds_total");
    expect(res.text).toContain("nodejs_heap_size_total_bytes");
  });

  it("includes service=nib default label", async () => {
    app = await createTestApp();

    const res = await request(app.getHttpServer()).get("/metrics");
    expect(res.text).toContain('service="nib"');
  });

  it("reports drawing gauge counts from DB", async () => {
    app = await createTestApp();
    const server = app.getHttpServer();

    // Create a public drawing
    await request(server)
      .post("/api/scenes")
      .send({ title: "Public", data: VALID_SCENE, is_public: true });

    // Create a private drawing
    await request(server)
      .post("/api/scenes")
      .send({ title: "Private", data: VALID_SCENE, is_public: false });

    const res = await request(server).get("/metrics");
    expect(res.status).toBe(200);

    // Gauge should show counts by visibility
    expect(res.text).toMatch(/nib_drawings_total\{.*visibility="public".*\}\s+1/);
    expect(res.text).toMatch(/nib_drawings_total\{.*visibility="private".*\}\s+1/);
  });

  it("reports user gauge count from DB", async () => {
    const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    app = await createAuthenticatedTestApp({ userId, sub: "test-sub", username: "testuser" });
    const server = app.getHttpServer();

    // Create a user via the authenticated test app's user module
    // The user isn't auto-created by the test helper — we need to create one in the DB
    const { getConnectionToken } = await import("@nestjs/sequelize");
    const { Sequelize } = await import("sequelize-typescript");
    const sequelize = app.get<InstanceType<typeof Sequelize>>(getConnectionToken());
    await sequelize.query(
      `INSERT INTO users (id, sub, username, role, created_at) VALUES ('${userId}', 'test-sub', 'testuser', 'user', datetime('now'))`,
    );

    const res = await request(server).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/nib_users_total\{.*\}\s+1/);
  });

  it("increments drawings_created counter on scene creation", async () => {
    app = await createTestApp();
    const server = app.getHttpServer();

    // Create two public drawings
    await request(server)
      .post("/api/scenes")
      .send({ title: "One", data: VALID_SCENE, is_public: true });
    await request(server)
      .post("/api/scenes")
      .send({ title: "Two", data: VALID_SCENE, is_public: true });

    // Create one private drawing
    await request(server)
      .post("/api/scenes")
      .send({ title: "Three", data: VALID_SCENE, is_public: false });

    const res = await request(server).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/nib_drawings_created_total\{.*visibility="public".*\}\s+2/);
    expect(res.text).toMatch(/nib_drawings_created_total\{.*visibility="private".*\}\s+1/);
  });

  it("increments drawings_deleted counter on scene deletion", async () => {
    app = await createTestApp();
    const server = app.getHttpServer();
    const agent = request.agent(server);

    // Create a drawing (anonymous — tracked by session)
    const createRes = await agent
      .post("/api/scenes")
      .send({ title: "ToDelete", data: VALID_SCENE, is_public: true });
    const sceneId = createRes.body.id;

    // Delete it (same session agent — has ownership)
    await agent.delete(`/api/scenes/${sceneId}`).expect(204);

    const res = await agent.get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/nib_drawings_deleted_total\{.*\}\s+1/);
  });
});
