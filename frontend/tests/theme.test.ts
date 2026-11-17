// Vitest runs in Node. The app tsconfig only loads DOM types.
// @ts-expect-error node builtin is available when the tests run
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accentKey, accents, applyAccent, readAccent, readTheme, themes } from "../src/lib/theme";

const css = readFileSync(new URL("../src/styles/main.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function stubStorage(values: Record<string, string> = {}, broken = false) {
  const store = new Map(Object.entries(values));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => {
      if (broken) throw new Error("denied");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error("denied");
      store.set(key, value);
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("accents", () => {
  it("reads a stored accent, and falls back to Mono", () => {
    stubStorage({ [accentKey]: "berry" });
    expect(readAccent()).toBe("berry");
    stubStorage({ [accentKey]: "neon" });
    expect(readAccent()).toBe("mono");
    stubStorage({}, true);
    expect(readAccent()).toBe("mono");
    expect(readTheme()).toBe("graphite");
  });

  it("applies the accent to the page and keeps it", () => {
    const store = stubStorage();
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    applyAccent("meadow");
    expect(dataset.accent).toBe("meadow");
    expect(store.get(accentKey)).toBe("meadow");
  });

  it("still applies when storage is blocked", () => {
    stubStorage({}, true);
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    applyAccent("glacier");
    expect(dataset.accent).toBe("glacier");
  });

  // index.html applies both before the app loads, from its own lists. They must match.
  it("has a colour block and a startup entry for every theme and accent", () => {
    for (const { id, background } of themes) {
      expect(css, id).toContain(`[data-theme="${id}"] {`);
      expect(html, id).toContain(`${id}: "${background}"`);
    }
    const startup = html.match(/var accents = \[([^\]]*)\]/)?.[1] ?? "";
    expect(startup.split(",").map((item: string) => item.trim().replace(/"/g, ""))).toEqual(accents.map((accent) => accent.id));
    for (const { id } of accents) expect(css, id).toContain(`[data-accent="${id}"] {`);
  });
});
