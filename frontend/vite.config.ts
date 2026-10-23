import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

// The dev server is the browser origin (http://localhost:5173). /api and
// /config.json are proxied to the API so the SPA and the API share an origin
// and no CORS setup is required. BIND_PORT comes from the repo .env.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const port = env.BIND_PORT || "8100";

  return {
    plugins: [vue()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": `http://127.0.0.1:${port}`,
        "/config.json": `http://127.0.0.1:${port}`,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
