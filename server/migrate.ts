import "reflect-metadata";
import { Sequelize } from "sequelize-typescript";
import { UserModel } from "./database/models/user.model.js";
import { SceneModel } from "./database/models/scene.model.js";

/**
 * Sync Sequelize models to the database.
 *
 * Usage:
 *   npx tsx server/migrate.ts          # safe sync (create missing tables only)
 *   npx tsx server/migrate.ts --alter   # alter existing tables to match models
 *   npx tsx server/migrate.ts --force   # drop & recreate (DESTRUCTIVE)
 */

async function migrate() {
  const flag = process.argv[2];

  const options =
    flag === "--force"
      ? { force: true }
      : flag === "--alter"
        ? { alter: true }
        : {};

  if (flag === "--force") {
    console.warn("WARNING: --force will DROP and recreate all tables!");
  }

  const sequelize = new Sequelize({
    dialect: "postgres",
    host: process.env.DB_HOST || "postgres.grid.local",
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME || "nib",
    username: process.env.DB_USER || "grid_admin",
    password: process.env.DB_PASS,
    logging: console.log,
    models: [UserModel, SceneModel],
  });

  try {
    await sequelize.authenticate();
    console.log("Connected to database.");

    await sequelize.sync(options);
    console.log("Models synced successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

migrate();
