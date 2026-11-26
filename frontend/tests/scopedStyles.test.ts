import { describe, expect, it } from "vitest";

// Every component's source, to check its scoped styles. The local mock folder is never shipped.
const sources = import.meta.glob("../src/**/*.vue", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("scoped styles", () => {
  it("never wrap the html text-size classes in :global(), which Vue compiles to a bare html rule", () => {
    const bad = Object.entries(sources)
      .filter(([path]) => !path.includes("/mock/"))
      .flatMap(([path, source]) => source.split("\n")
        .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
        .filter(({ line }) => /:global\(\s*html[^)]*\)\s*[^\s{,]/.test(line))
        .map(({ at }) => at));
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
