import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { Plugin } from "vite";

export default defineConfig({
  // Cast needed: vitest bundles its own vite, causing a Plugin type mismatch.
  plugins: [react() as unknown as Plugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ionic/react": path.resolve(__dirname, "./src/__mocks__/@ionic/react.tsx"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    exclude: ["node_modules", "dist", "e2e"],
    css: false,
  },
});
