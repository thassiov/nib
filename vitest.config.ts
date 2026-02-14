import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts", "client/**/*.test.tsx"],
    setupFiles: ["server/__tests__/setup.ts"],
    // Run test files sequentially since server tests share SQLite in-memory DB
    pool: "forks",
    isolate: false,
    // Client tests use @vitest-environment jsdom per-file
    environmentMatchGlobs: [
      ["client/**/*.test.tsx", "jsdom"],
    ],
  },
});
