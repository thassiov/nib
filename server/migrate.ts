import { sequelize } from "./db.js";

/**
 * Sync Sequelize models to the database.
 *
 * Usage:
 *   npx tsx server/migrate.ts          # safe sync (create missing tables only)
 *   npx tsx server/migrate.ts --alter   # alter existing tables to match models
 *   npx tsx server/migrate.ts --force   # drop & recreate (DESTRUCTIVE)
 *
 * Alternatively, use the raw SQL migration:
 *   psql -h postgres.grid.local -U grid_admin -d nib -f migrations/001_initial.sql
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
