import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const port = Number(process.env.PORT ?? "5175");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const apiTarget = process.env.WORKSPACE_API_PROXY ?? "http://localhost:8080";

export default defineConfig({
  base: "/workspace/",
  plugins: [react()],
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
  },
});
