/**
 * Global test setup - creates a shared SQLite Sequelize instance with models.
 */
import "reflect-metadata";
import { Sequelize } from "sequelize-typescript";
import { UserModel } from "../database/models/user.model.js";
import { SceneModel } from "../database/models/scene.model.js";

// Create a shared SQLite Sequelize instance for model-level tests (db.test.ts)
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
  models: [UserModel, SceneModel],
  pool: { max: 1, min: 1 },
  hooks: {
    afterConnect: async (connection: unknown) => {
      // SQLite requires PRAGMA foreign_keys per-connection
      await (connection as any).run("PRAGMA foreign_keys = ON;");
    },
  },
});

// Sync models before tests
beforeAll(async () => {
  // Ensure foreign keys are on for the initial connection
  await sequelize.query("PRAGMA foreign_keys = ON;");
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});

export { sequelize };
