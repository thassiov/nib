import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        // Only proxy actual API calls, not client source files under client/api/
        bypass(req) {
          if (req.url?.match(/\.(ts|tsx|js|jsx|css|json)$/)) {
            return req.url;
          }
        },
      },
      "/auth": "http://localhost:3000",
    },
  },
});
