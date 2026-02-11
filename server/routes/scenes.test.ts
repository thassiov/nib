import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { User, Scene, sequelize } from "../db.js";
import { createApp, createAuthenticatedApp, VALID_SCENE } from "../__tests__/helpers.js";

describe("Scene routes", () => {
  let userId: string;

  beforeEach(async () => {
    // Reset tables before each test
    await Scene.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Create a test user
    const user = await User.create({ sub: "oidc-sub-1", username: "alice" });
    userId = user.id;
  });

  // ========== Validation ==========

  describe("POST /api/scenes/validate", () => {
    it("validates a correct scene", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scenes/validate").send(VALID_SCENE);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.elementCount).toBe(1);
    });

    it("rejects invalid scene with 422 and errors", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scenes/validate").send({ elements: "bad" });
      expect(res.status).toBe(422);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it("does not require authentication", async () => {
      const app = createApp(); // No session
      const res = await request(app).post("/api/scenes/validate").send(VALID_SCENE);
      expect(res.status).toBe(200);
    });
  });

  // ========== Public gallery ==========

  describe("GET /api/scenes (public gallery)", () => {
    it("returns only public scenes", async () => {
      await Scene.create({ user_id: userId, title: "Public", data: VALID_SCENE, is_public: true });
      await Scene.create({ user_id: userId, title: "Private", data: VALID_SCENE, is_public: false });

      const app = createApp();
      const res = await request(app).get("/api/scenes");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(1);
      expect(res.body.scenes[0].title).toBe("Public");
      expect(res.body.pagination.total).toBe(1);
    });

    it("paginates results", async () => {
      for (let i = 0; i < 5; i++) {
        await Scene.create({ user_id: userId, title: `Scene ${i}`, data: VALID_SCENE, is_public: true });
      }

      const app = createApp();
      const res = await request(app).get("/api/scenes?page=1&limit=2");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(2);
      expect(res.body.pagination.pages).toBe(3);
    });
  });

  // ========== My scenes ==========

  describe("GET /api/scenes/my", () => {
    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await request(app).get("/api/scenes/my");
      expect(res.status).toBe(401);
    });

    it("returns only the user's scenes", async () => {
      const otherUser = await User.create({ sub: "oidc-sub-2", username: "bob" });
      await Scene.create({ user_id: userId, title: "Alice scene", data: VALID_SCENE });
      await Scene.create({ user_id: otherUser.id, title: "Bob scene", data: VALID_SCENE });

      const app = createAuthenticatedApp({ userId });
      const res = await request(app).get("/api/scenes/my");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(1);
      expect(res.body.scenes[0].title).toBe("Alice scene");
    });
  });

  // ========== Get single scene ==========

  describe("GET /api/scenes/:id", () => {
    it("returns public scene to anonymous user", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Public", data: VALID_SCENE, is_public: true });
      const app = createApp();
      const res = await request(app).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Public");
    });

    it("returns private scene to owner", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Private", data: VALID_SCENE, is_public: false });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Private");
    });

    it("hides private scene from non-owner", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Private", data: VALID_SCENE, is_public: false });
      const app = createAuthenticatedApp({ userId: "other-user-id" });
      const res = await request(app).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(404);
    });

    it("hides private scene from anonymous user", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Private", data: VALID_SCENE, is_public: false });
      const app = createApp();
      const res = await request(app).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent scene", async () => {
      const app = createApp();
      const res = await request(app).get("/api/scenes/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // ========== Create scene ==========

  describe("POST /api/scenes", () => {
    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await request(app).post("/api/scenes").send({ data: VALID_SCENE });
      expect(res.status).toBe(401);
    });

    it("creates scene with valid data", async () => {
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).post("/api/scenes").send({ title: "My Drawing", data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("My Drawing");
      expect(res.body.user_id).toBe(userId);
      expect(res.body.is_public).toBe(false);
    });

    it("defaults title to 'Untitled'", async () => {
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).post("/api/scenes").send({ data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Untitled");
    });

    it("rejects invalid scene data with 422", async () => {
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).post("/api/scenes").send({ data: { elements: "not-array" } });
      expect(res.status).toBe(422);
      expect(res.body.validation.valid).toBe(false);
    });
  });

  // ========== Update scene ==========

  describe("PUT /api/scenes/:id", () => {
    it("returns 401 without auth", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createApp();
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ title: "New Title" });
      expect(res.status).toBe(401);
    });

    it("updates scene owned by user", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Old", data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ title: "New" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New");
    });

    it("returns 403 for scene owned by someone else", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId: "other-user-id" });
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ title: "Hack" });
      expect(res.status).toBe(403);
    });

    it("validates new scene data on update", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ data: { elements: 42 } });
      expect(res.status).toBe(422);
    });

    it("allows partial update (title only, no data)", async () => {
      const scene = await Scene.create({ user_id: userId, title: "Old", data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ title: "New" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New");
    });

    it("can toggle is_public", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE, is_public: false });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).put(`/api/scenes/${scene.id}`).send({ is_public: true });
      expect(res.status).toBe(200);
      expect(res.body.is_public).toBe(true);
    });
  });

  // ========== Delete scene ==========

  describe("DELETE /api/scenes/:id", () => {
    it("returns 401 without auth", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createApp();
      const res = await request(app).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(401);
    });

    it("deletes scene owned by user", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(204);

      // Verify deleted
      const found = await Scene.findByPk(scene.id);
      expect(found).toBeNull();
    });

    it("returns 403 for scene owned by someone else", async () => {
      const scene = await Scene.create({ user_id: userId, data: VALID_SCENE });
      const app = createAuthenticatedApp({ userId: "other-user-id" });
      const res = await request(app).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent scene", async () => {
      const app = createAuthenticatedApp({ userId });
      const res = await request(app).delete("/api/scenes/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });
});
