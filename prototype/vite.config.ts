import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Front-end-only prototype of Gym Bro Phase 1.
// - `vite build`               -> dist/ (relative base, hash routing: works from any sub-path)
// - `vite build --mode single` -> one self-contained index.html (JS, CSS, font, icons inlined) that opens from disk;
//   it has no manifest/service worker — deploy dist/ for the home-screen app (S4)
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    base: "./",
    plugins: single
      ? [vue(), viteSingleFile(), {
          // the single file has no manifest/service worker next to it: drop the link (icons are inlined)
          name: "drop-manifest",
          transformIndexHtml: (html: string) => html.replace(/\s*<link rel="manifest"[^>]*>/, ""),
        }]
      : [vue()],
    server: { port: 5174 },
    build: {
      outDir: single ? "dist-single" : "dist",
      emptyOutDir: true,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
  };
});
