/**
 * Global test setup - swaps Sequelize to SQLite in-memory before any tests run.
 */
import { initDb, sequelize } from "../db.js";

// Reinitialize with SQLite in-memory for all tests
initDb({
  dialect: "sqlite",
  storage: ":memory:",
  logging: false,
});

// Sync models before tests (creates tables in SQLite)
beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});
