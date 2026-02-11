import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts"],
    setupFiles: ["server/__tests__/setup.ts"],
    // Run test files sequentially since they share SQLite in-memory DB
    pool: "forks",
    isolate: false,
  },
});
