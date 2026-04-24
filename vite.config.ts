import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  base: "/picture-to-palette/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Picture to Palette",
        short_name: "Palette",
        description:
          "Turn photos of wool balls and traced designs into DMC/yarn palettes and shopping lists.",
        theme_color: "#3b6cff",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/picture-to-palette/",
        icons: [
          { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    host: true,
  },
});
