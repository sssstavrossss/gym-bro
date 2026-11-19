import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";


/** Chunks only the barcode scanner loads. Scanning needs a connection to look the code up, so they aren't kept. */
const scannerOnly = /barcode-detector|zxing/;

function publicFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  try { walk(dir); } catch { /* no public dir */ }
  return found;
}

function worker(shell: string[], version: string): string {
  // Read each time, so the dev server picks up an edit without a restart.
  return readFileSync(new URL("./worker.js", import.meta.url), "utf8")
    .replace('"__VERSION__"', JSON.stringify(version))
    .replace("/*__SHELL__*/ []", JSON.stringify(shell, null, 2));
}

/**
 * Writes /sw.js with the list of files the app needs to open offline, and a version that
 * changes whenever one of them does. The dev server gets a worker that keeps nothing.
 */
export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "gymbro-service-worker",
    apply: () => true,
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use("/sw.js", (_request, response) => {
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader("Cache-Control", "no-cache");
        response.end(worker([], "dev"));
      });
    },
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const shell = new Set<string>(["/index.html"]);
      for (const file of Object.values(bundle)) {
        if (file.fileName.endsWith(".map") || file.fileName.endsWith(".wasm")) continue;
        if (file.type === "chunk" && file.isDynamicEntry && Object.keys(file.modules).some((id) => scannerOnly.test(id))) continue;
        shell.add(`/${file.fileName}`);
        hash.update(file.fileName);
        if (file.fileName === "index.html" && file.type === "asset") hash.update(String(file.source));
      }
      for (const path of publicFiles(config.publicDir)) {
        const name = relative(config.publicDir, path).split(sep).join("/");
        shell.add(`/${name}`);
        hash.update(name).update(readFileSync(path));
      }
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: worker([...shell].sort(), hash.digest("hex").slice(0, 12)),
      });
    },
  };
}
