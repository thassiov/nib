import { describe, it, expect, beforeEach } from "vitest";
import { User, Scene, sequelize } from "./db.js";

describe("Database models", () => {
  beforeEach(async () => {
    await Scene.destroy({ where: {} });
    await User.destroy({ where: {} });
  });

  // ========== User model ==========

  describe("User", () => {
    it("creates a user with auto-generated UUID", async () => {
      const user = await User.create({ sub: "oidc-sub-1", username: "alice" });
      expect(user.id).toBeDefined();
      expect(user.id.length).toBe(36); // UUID format
      expect(user.sub).toBe("oidc-sub-1");
      expect(user.username).toBe("alice");
    });

    it("enforces unique sub constraint", async () => {
      await User.create({ sub: "oidc-sub-1", username: "alice" });
      await expect(User.create({ sub: "oidc-sub-1", username: "bob" })).rejects.toThrow();
    });

    it("allows null email and avatar_url", async () => {
      const user = await User.create({ sub: "sub", username: "test" });
      expect(user.email).toBeNull();
      expect(user.avatar_url).toBeNull();
    });

    it("supports upsert on sub", async () => {
      await User.create({ sub: "oidc-sub-1", username: "alice", email: "old@test.com" });
      const [updated] = await User.upsert({ sub: "oidc-sub-1", username: "alice-updated", email: "new@test.com" });
      expect(updated.username).toBe("alice-updated");
      expect(updated.email).toBe("new@test.com");

      // Should still be one user
      const count = await User.count();
      expect(count).toBe(1);
    });
  });

  // ========== Scene model ==========

  describe("Scene", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await User.create({ sub: "oidc-sub-1", username: "alice" });
      userId = user.id;
    });

    it("creates scene with JSONB data", async () => {
      const data = { elements: [{ id: "e1", type: "rectangle" }], appState: {} };
      const scene = await Scene.create({ user_id: userId, data });
      expect(scene.id).toBeDefined();
      expect(scene.data).toEqual(data);
      expect(scene.title).toBe("Untitled");
      expect(scene.is_public).toBe(false);
    });

    it("persists and retrieves complex scene data", async () => {
      const data = {
        elements: [
          { id: "e1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, nested: { a: [1, 2, 3] } },
        ],
        appState: { zoom: { value: 1.5 } },
        files: { f1: { mimeType: "image/png" } },
      };
      const scene = await Scene.create({ user_id: userId, data });
      const fetched = await Scene.findByPk(scene.id);
      expect(fetched!.data).toEqual(data);
    });

    it("defaults is_public to false", async () => {
      const scene = await Scene.create({ user_id: userId, data: {} });
      expect(scene.is_public).toBe(false);
    });

    it("can be set to public", async () => {
      const scene = await Scene.create({ user_id: userId, data: {}, is_public: true });
      expect(scene.is_public).toBe(true);
    });
  });

  // ========== Associations ==========

  describe("Associations", () => {
    it("User hasMany Scenes", async () => {
      const user = await User.create({ sub: "sub1", username: "alice" });
      await Scene.create({ user_id: user.id, data: {}, title: "S1" });
      await Scene.create({ user_id: user.id, data: {}, title: "S2" });

      const userWithScenes = await User.findByPk(user.id, {
        include: [{ model: Scene, as: "scenes" }],
      });
      expect((userWithScenes as any).scenes.length).toBe(2);
    });

    it("Scene belongsTo User", async () => {
      const user = await User.create({ sub: "sub1", username: "alice" });
      const scene = await Scene.create({ user_id: user.id, data: {} });

      const sceneWithUser = await Scene.findByPk(scene.id, {
        include: [{ model: User, as: "user" }],
      });
      expect((sceneWithUser as any).user.username).toBe("alice");
    });

    it("deleting user cascades to scenes", async () => {
      const user = await User.create({ sub: "sub1", username: "alice" });
      await Scene.create({ user_id: user.id, data: {} });
      await Scene.create({ user_id: user.id, data: {} });

      await user.destroy();
      const count = await Scene.count();
      expect(count).toBe(0);
    });
  });
});
