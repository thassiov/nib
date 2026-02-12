import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { getConnectionToken } from "@nestjs/sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserModel } from "../database/models/user.model.js";
import { SceneModel } from "../database/models/scene.model.js";
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
    it("returns 403 without auth", async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).post("/api/scenes").send({ data: VALID_SCENE });
      expect(res.status).toBe(403);
    });

    it("creates scene with valid data", async () => {
      app = await createAuthenticatedTestApp({ userId: ALICE_ID });
      await seedAlice(app);

      const res = await request(app.getHttpServer()).post("/api/scenes").send({ title: "My Drawing", data: VALID_SCENE });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("My Drawing");
      expect(res.body.user_id).toBe(ALICE_ID);
      expect(res.body.is_public).toBe(false);
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
});
