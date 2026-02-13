import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { getConnectionToken } from "@nestjs/sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserModel } from "../database/models/user.model.js";
import { SceneModel } from "../database/models/scene.model.js";
import { ScenesRepository } from "./scenes.repository.js";
import { createTestApp, createAuthenticatedTestApp, VALID_SCENE } from "../__tests__/helpers.js";

// Fixed UUIDs for deterministic tests
const ALICE_ID = "a0000000-0000-0000-0000-000000000001";
const BOB_ID = "b0000000-0000-0000-0000-000000000002";

function getUserModel(app: INestApplication): typeof UserModel {
  const seq = app.get<Sequelize>(getConnectionToken());
  return seq.models.UserModel as unknown as typeof UserModel;
}

function getSceneModel(app: INestApplication): typeof SceneModel {
  const seq = app.get<Sequelize>(getConnectionToken());
  return seq.models.SceneModel as unknown as typeof SceneModel;
}

async function seedAlice(app: INestApplication): Promise<UserModel> {
  return getUserModel(app).create({ id: ALICE_ID, sub: "oidc-sub-1", username: "alice" } as any);
}

async function seedBob(app: INestApplication): Promise<UserModel> {
  return getUserModel(app).create({ id: BOB_ID, sub: "oidc-sub-2", username: "bob" } as any);
}

describe("Scene routes", () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined as any;
    }
  });

  // ========== Validation ==========

  describe("POST /api/scenes/validate", () => {
    it("validates a correct scene", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).post("/api/scenes/validate").send(VALID_SCENE);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.elementCount).toBe(1);
    });

    it("rejects invalid scene with errors", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).post("/api/scenes/validate").send({ elements: "bad" });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it("does not require authentication", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).post("/api/scenes/validate").send(VALID_SCENE);
      expect(res.status).toBe(200);
    });
  });

  // ========== Public gallery ==========

  describe("GET /api/scenes (public gallery)", () => {
    it("returns only public scenes", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const Scene = getSceneModel(app);
      await Scene.create({ user_id: user.id, title: "Public", data: VALID_SCENE, is_public: true });
      await Scene.create({ user_id: user.id, title: "Private", data: VALID_SCENE, is_public: false });

      const res = await request(app.getHttpServer()).get("/api/scenes");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(1);
      expect(res.body.scenes[0].title).toBe("Public");
      expect(res.body.pagination.total).toBe(1);
    });

    it("paginates results", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const Scene = getSceneModel(app);
      for (let i = 0; i < 5; i++) {
        await Scene.create({ user_id: user.id, title: `Scene ${i}`, data: VALID_SCENE, is_public: true });
      }

      const res = await request(app.getHttpServer()).get("/api/scenes?page=1&limit=2");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(2);
      expect(res.body.pagination.pages).toBe(3);
    });
  });

  // ========== My scenes ==========

  describe("GET /api/scenes/my", () => {
    it("returns 403 without auth", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).get("/api/scenes/my");
      expect(res.status).toBe(403);
    });

    it("returns only the user's scenes", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const bob = await seedBob(app);
      const Scene = getSceneModel(app);
      await Scene.create({ user_id: ALICE_ID, title: "Alice scene", data: VALID_SCENE });
      await Scene.create({ user_id: bob.id, title: "Bob scene", data: VALID_SCENE });

      const res = await request(app.getHttpServer()).get("/api/scenes/my");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(1);
      expect(res.body.scenes[0].title).toBe("Alice scene");
    });
  });

  // ========== Get single scene ==========

  describe("GET /api/scenes/:id", () => {
    it("returns public scene to anonymous user", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: user.id, title: "Public", data: VALID_SCENE, is_public: true,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Public");
    });

    it("returns private scene to owner", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: ALICE_ID, title: "Private", data: VALID_SCENE, is_public: false,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Private");
    });

    it("hides private scene from non-owner", async () => {
      app = await createAuthenticatedTestApp({ userId: "other-user-id" });
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: user.id, title: "Private", data: VALID_SCENE, is_public: false,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(404);
    });

    it("hides private scene from anonymous user", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: user.id, title: "Private", data: VALID_SCENE, is_public: false,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent scene", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).get("/api/scenes/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // ========== Create scene ==========

  describe("POST /api/scenes", () => {
    it("creates scene with valid data (authenticated)", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer()).post("/api/scenes").send({ title: "My Drawing", data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("My Drawing");
      expect(res.body.user_id).toBe(ALICE_ID);
      expect(res.body.is_public).toBe(false);
    });

    it("creates scene without auth (anonymous)", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer()).post("/api/scenes").send({ title: "Anon Drawing", data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Anon Drawing");
      expect(res.body.user_id).toBeNull();
      expect(res.body.is_public).toBe(true);
    });

    it("defaults title to 'Untitled'", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer()).post("/api/scenes").send({ data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Untitled");
    });

    it("rejects invalid scene data with 422", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer()).post("/api/scenes").send({ data: { elements: "not-array" } });
      expect(res.status).toBe(422);
      expect(res.body.validation.valid).toBe(false);
    });
  });

  // ========== Update scene ==========

  describe("PUT /api/scenes/:id", () => {
    it("returns 403 without auth", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: user.id, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ title: "New Title" });
      expect(res.status).toBe(403);
    });

    it("updates scene owned by user", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: ALICE_ID, title: "Old", data: VALID_SCENE });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ title: "New" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New");
    });

    it("returns 403 for scene owned by someone else", async () => {
      app = await createAuthenticatedTestApp({ userId: "other-user-id" });
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: user.id, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ title: "Hack" });
      expect(res.status).toBe(403);
    });

    it("validates new scene data on update", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: ALICE_ID, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ data: { elements: 42 } });
      expect(res.status).toBe(422);
    });

    it("allows partial update (title only, no data)", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: ALICE_ID, title: "Old", data: VALID_SCENE });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ title: "New" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New");
    });

    it("can toggle is_public", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: ALICE_ID, data: VALID_SCENE, is_public: false });

      const res = await request(app.getHttpServer()).put(`/api/scenes/${scene.id}`).send({ is_public: true });
      expect(res.status).toBe(200);
      expect(res.body.is_public).toBe(true);
    });
  });

  // ========== Delete scene ==========

  describe("DELETE /api/scenes/:id", () => {
    it("returns 403 without auth", async () => {
      app = await createTestApp();
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: user.id, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(403);
    });

    it("deletes scene owned by user", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: ALICE_ID, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(204);

      const found = await getSceneModel(app).findByPk(scene.id);
      expect(found).toBeNull();
    });

    it("returns 403 for scene owned by someone else", async () => {
      app = await createAuthenticatedTestApp({ userId: "other-user-id" });
      const user = await seedAlice(app);
      const scene = await getSceneModel(app).create({ user_id: user.id, data: VALID_SCENE });

      const res = await request(app.getHttpServer()).delete(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent scene", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer()).delete("/api/scenes/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // ========== Upload (authenticated) ==========

  describe("POST /api/scenes/upload (authenticated)", () => {
    it("creates scene from uploaded .excalidraw file", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "my-drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("my-drawing");
      expect(res.body.user_id).toBe(ALICE_ID);
      expect(res.body.is_public).toBe(false);
    });

    it("defaults is_public to false when authenticated", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.is_public).toBe(false);
    });

    it("allows authenticated user to override is_public to true", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .field("is_public", "true")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.is_public).toBe(true);
    });

    it("accepts .json file extension", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "scene.json");

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("scene");
    });

    it("uses provided title instead of filename", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .field("title", "Custom Title")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Custom Title");
    });

    it("strips file extension from default title", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "project-sketch.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("project-sketch");
    });
  });

  // ========== Upload (anonymous) ==========

  describe("POST /api/scenes/upload (anonymous)", () => {
    it("creates scene without authentication", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "anon-drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("anon-drawing");
    });

    it("sets user_id to null for anonymous uploads", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.user_id).toBeNull();
    });

    it("defaults is_public to true for anonymous uploads", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.is_public).toBe(true);
    });

    it("allows anonymous user to override is_public to false", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .field("is_public", "false")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "drawing.excalidraw");

      expect(res.status).toBe(201);
      expect(res.body.is_public).toBe(false);
    });

    it("anonymous scene appears in public gallery", async () => {
      app = await createTestApp();

      await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(VALID_SCENE)), "public-drawing.excalidraw");

      const res = await request(app.getHttpServer()).get("/api/scenes");
      expect(res.status).toBe(200);
      expect(res.body.scenes.length).toBe(1);
      expect(res.body.scenes[0].title).toBe("public-drawing");
    });
  });

  // ========== Upload (error cases) ==========

  describe("POST /api/scenes/upload (errors)", () => {
    it("returns 400 when no file is provided", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .field("title", "No file");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no file/i);
    });

    it("returns 400 for non-JSON file content", async () => {
      app = await createTestApp();

      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from("this is not json"), "drawing.excalidraw");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not valid json/i);
    });

     it("returns 422 for invalid scene data in file", async () => {
      app = await createTestApp();

      const invalidScene = { elements: "not-an-array" };
      const res = await request(app.getHttpServer())
        .post("/api/scenes/upload")
        .attach("file", Buffer.from(JSON.stringify(invalidScene)), "bad.excalidraw");

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/invalid scene/i);
      expect(res.body.validation).toBeDefined();
    });
  });

  // ========== Anonymous session ownership ==========

  describe("Anonymous session ownership", () => {
    it("anonymous user can update scene they created (via session)", async () => {
      app = await createTestApp();
      const agent = request.agent(app.getHttpServer());

      // Create scene — session gets ownedScenes
      const createRes = await agent.post("/api/scenes").send({ data: VALID_SCENE, title: "Anon Scene" });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      // Update using same session
      const updateRes = await agent.put(`/api/scenes/${sceneId}`).send({ title: "Updated Anon" });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.title).toBe("Updated Anon");
    });

    it("anonymous user can delete scene they created (via session)", async () => {
      app = await createTestApp();
      const agent = request.agent(app.getHttpServer());

      const createRes = await agent.post("/api/scenes").send({ data: VALID_SCENE });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      const deleteRes = await agent.delete(`/api/scenes/${sceneId}`);
      expect(deleteRes.status).toBe(204);
    });

    it("different anonymous session cannot update someone else's anonymous scene", async () => {
      app = await createTestApp();
      const agent1 = request.agent(app.getHttpServer());
      const agent2 = request.agent(app.getHttpServer());

      // Agent 1 creates scene
      const createRes = await agent1.post("/api/scenes").send({ data: VALID_SCENE });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      // Agent 2 (different session) tries to update
      const updateRes = await agent2.put(`/api/scenes/${sceneId}`).send({ title: "Hacked" });
      expect(updateRes.status).toBe(403);
    });

    it("different anonymous session cannot delete someone else's anonymous scene", async () => {
      app = await createTestApp();
      const agent1 = request.agent(app.getHttpServer());
      const agent2 = request.agent(app.getHttpServer());

      const createRes = await agent1.post("/api/scenes").send({ data: VALID_SCENE });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      const deleteRes = await agent2.delete(`/api/scenes/${sceneId}`);
      expect(deleteRes.status).toBe(403);
    });

    it("GET /api/scenes/:id returns canEdit=true for anonymous owner", async () => {
      app = await createTestApp();
      const agent = request.agent(app.getHttpServer());

      const createRes = await agent.post("/api/scenes").send({ data: VALID_SCENE });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      const getRes = await agent.get(`/api/scenes/${sceneId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.canEdit).toBe(true);
    });

    it("GET /api/scenes/:id returns canEdit=false for different anonymous session", async () => {
      app = await createTestApp();
      const agent1 = request.agent(app.getHttpServer());
      const agent2 = request.agent(app.getHttpServer());

      const createRes = await agent1.post("/api/scenes").send({ data: VALID_SCENE });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      const getRes = await agent2.get(`/api/scenes/${sceneId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.canEdit).toBe(false);
    });

    it("GET /api/scenes/:id returns canEdit=true for authenticated owner", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: ALICE_ID, title: "Mine", data: VALID_SCENE, is_public: true,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.canEdit).toBe(true);
    });

    it("GET /api/scenes/:id returns canEdit=false for non-owner", async () => {
      app = await createAuthenticatedTestApp({ userId: "other-user-id" });
      const alice = await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: alice.id, title: "Not Mine", data: VALID_SCENE, is_public: true,
      });

      const res = await request(app.getHttpServer()).get(`/api/scenes/${scene.id}`);
      expect(res.status).toBe(200);
      expect(res.body.canEdit).toBe(false);
    });

    it("anonymous scene defaults to is_public=true", async () => {
      app = await createTestApp();
      const agent = request.agent(app.getHttpServer());

      const res = await agent.post("/api/scenes").send({ data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.is_public).toBe(true);
      expect(res.body.user_id).toBeNull();
    });

    it("anonymous user can update scene data and autosave works", async () => {
      app = await createTestApp();
      const agent = request.agent(app.getHttpServer());

      const createRes = await agent.post("/api/scenes").send({ data: VALID_SCENE, title: "Draft" });
      expect(createRes.status).toBe(201);
      const sceneId = createRes.body.id;

      // Simulate autosave with new data
      const updatedScene = {
        elements: [{ id: "rect2", type: "rectangle", x: 10, y: 10, width: 200, height: 100 }],
        appState: {},
        files: {},
      };
      const updateRes = await agent.put(`/api/scenes/${sceneId}`).send({ data: updatedScene });
      expect(updateRes.status).toBe(200);

      // Verify data persisted
      const getRes = await agent.get(`/api/scenes/${sceneId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.elements[0].id).toBe("rect2");
    });
  });

  // ========== Thumbnail ==========

  describe("Thumbnail support", () => {
    const THUMB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

    it("stores thumbnail on create", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes")
        .send({ title: "With Thumb", data: VALID_SCENE, thumbnail: THUMB });

      expect(res.status).toBe(201);
      expect(res.body.thumbnail).toBe(THUMB);
    });

    it("stores thumbnail on update", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      const scene = await getSceneModel(app).create({
        user_id: ALICE_ID, title: "No Thumb", data: VALID_SCENE, is_public: false,
      });

      const res = await request(app.getHttpServer())
        .put(`/api/scenes/${scene.id}`)
        .send({ thumbnail: THUMB });

      expect(res.status).toBe(200);
      expect(res.body.thumbnail).toBe(THUMB);
    });

    it("returns thumbnail in list responses", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);
      await getSceneModel(app).create({
        user_id: ALICE_ID, title: "Listed", data: VALID_SCENE, is_public: true, thumbnail: THUMB,
      });

      const res = await request(app.getHttpServer()).get("/api/scenes");
      expect(res.status).toBe(200);
      expect(res.body.scenes[0].thumbnail).toBe(THUMB);
    });

    it("defaults thumbnail to null when not provided", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer())
        .post("/api/scenes")
        .send({ title: "No Thumb", data: VALID_SCENE });

      expect(res.status).toBe(201);
      expect(res.body.thumbnail ?? null).toBeNull();
    });
  });

  // ========== Scene adoption on login ==========

  describe("Scene adoption (adoptByIds)", () => {
    it("adopts orphaned scenes for a user", async () => {
      app = await createTestApp();
      await seedAlice(app);
      const SceneModelRef = getSceneModel(app);
      const repo = app.get(ScenesRepository);

      // Create two orphaned scenes (anonymous)
      const s1 = await SceneModelRef.create({ title: "Anon 1", data: VALID_SCENE, is_public: true, user_id: null });
      const s2 = await SceneModelRef.create({ title: "Anon 2", data: VALID_SCENE, is_public: true, user_id: null });

      const adopted = await repo.adoptByIds([s1.id, s2.id], ALICE_ID);
      expect(adopted).toBe(2);

      // Verify scenes now belong to Alice
      const updated1 = await SceneModelRef.findByPk(s1.id);
      const updated2 = await SceneModelRef.findByPk(s2.id);
      expect(updated1!.user_id).toBe(ALICE_ID);
      expect(updated2!.user_id).toBe(ALICE_ID);
    });

    it("does not adopt scenes that already have an owner", async () => {
      app = await createTestApp();
      await seedAlice(app);
      await seedBob(app);
      const SceneModelRef = getSceneModel(app);
      const repo = app.get(ScenesRepository);

      // Create a scene owned by Bob
      const bobScene = await SceneModelRef.create({ title: "Bob's", data: VALID_SCENE, is_public: true, user_id: BOB_ID });

      const adopted = await repo.adoptByIds([bobScene.id], ALICE_ID);
      expect(adopted).toBe(0);

      // Verify scene still belongs to Bob
      const updated = await SceneModelRef.findByPk(bobScene.id);
      expect(updated!.user_id).toBe(BOB_ID);
    });

    it("handles mixed owned and orphaned scenes", async () => {
      app = await createTestApp();
      await seedAlice(app);
      await seedBob(app);
      const SceneModelRef = getSceneModel(app);
      const repo = app.get(ScenesRepository);

      const orphan = await SceneModelRef.create({ title: "Orphan", data: VALID_SCENE, is_public: true, user_id: null });
      const bobScene = await SceneModelRef.create({ title: "Bob's", data: VALID_SCENE, is_public: true, user_id: BOB_ID });

      const adopted = await repo.adoptByIds([orphan.id, bobScene.id], ALICE_ID);
      expect(adopted).toBe(1);

      expect((await SceneModelRef.findByPk(orphan.id))!.user_id).toBe(ALICE_ID);
      expect((await SceneModelRef.findByPk(bobScene.id))!.user_id).toBe(BOB_ID);
    });

    it("returns 0 for empty scene list", async () => {
      app = await createTestApp();
      const repo = app.get(ScenesRepository);

      const adopted = await repo.adoptByIds([], ALICE_ID);
      expect(adopted).toBe(0);
    });

    it("returns 0 for non-existent scene IDs", async () => {
      app = await createTestApp();
      const repo = app.get(ScenesRepository);

      const adopted = await repo.adoptByIds(["nonexistent-id-1", "nonexistent-id-2"], ALICE_ID);
      expect(adopted).toBe(0);
    });

    it("adopted scenes are accessible via authenticated owner", async () => {
      // Simulate the full flow: anonymous creates, then logs in and scenes get adopted
      app = await createTestApp();
      await seedAlice(app);
      const SceneModelRef = getSceneModel(app);
      const repo = app.get(ScenesRepository);
      const agent = request.agent(app.getHttpServer());

      // Anonymous user creates two scenes
      const r1 = await agent.post("/api/scenes").send({ data: VALID_SCENE, title: "Drawing 1" });
      const r2 = await agent.post("/api/scenes").send({ data: VALID_SCENE, title: "Drawing 2" });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      // Both are orphaned
      expect(r1.body.user_id).toBeNull();
      expect(r2.body.user_id).toBeNull();

      // Simulate login adoption
      await repo.adoptByIds([r1.body.id, r2.body.id], ALICE_ID);

      // Verify scenes now belong to Alice
      const s1 = await SceneModelRef.findByPk(r1.body.id);
      const s2 = await SceneModelRef.findByPk(r2.body.id);
      expect(s1!.user_id).toBe(ALICE_ID);
      expect(s2!.user_id).toBe(ALICE_ID);
    });
  });
});
