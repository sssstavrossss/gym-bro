import { describe, expect, it } from "vitest";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../src/lib/foodSearch";

describe("food search typing", () => {
  it("sends a partial phrase and waits one debounce", () => {
    expect(preparedSearch("chicken br")).toEqual({ kind: "query", query: "chicken br" });
    expect(preparedSearch("  chicken   br ")).toEqual({ kind: "query", query: "chicken   br" });
    expect(searchDebounceMs).toBe(200);
  });

  it("does not search a single letter", () => {
    expect(preparedSearch("c")).toEqual({ kind: "hint", message: "Type at least 2 letters." });
    expect(preparedSearch("  ")).toEqual({ kind: "clear" });
  });

  it("ignores a response from an older request", () => {
    expect(acceptSearchResult(2, "chicken br", 2, "chicken br")).toBe(true);
    expect(acceptSearchResult(2, "chicken br", 3, "chicken bra")).toBe(false);
    expect(acceptSearchResult(2, "chicken br", 2, "chicken bra")).toBe(false);
  });
});