import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOME_HIDDEN_KEY, HOME_SECTIONS, readHiddenSections, sectionRows, sectionsSummary, toggleSection, writeHiddenSections,
} from "../src/lib/homeSections";

function stubStorage(values: Record<string, string> = {}, broken = false) {
  const store = new Map(Object.entries(values));
  const guard = () => { if (broken) throw new Error("denied"); };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { guard(); return store.get(key) ?? null; },
    setItem: (key: string, value: string) => { guard(); store.set(key, value); },
    removeItem: (key: string) => { guard(); store.delete(key); },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("home sections", () => {
  it("lists Home's cards in order, without the week", () => {
    expect(HOME_SECTIONS.map((row) => row.id)).toEqual(["suggestions", "macros", "foods", "progress"]);
  });

  it("switches a card off and on, keeping Home's order", () => {
    let hidden = toggleSection([], "progress", false);
    hidden = toggleSection(hidden, "suggestions", false);
    expect(hidden).toEqual(["suggestions", "progress"]);
    expect(toggleSection(hidden, "suggestions", true)).toEqual(["progress"]);
    // An id that's no longer a card drops out.
    expect(toggleSection(["gone", "foods"], "macros", false)).toEqual(["macros", "foods"]);
  });

  it("counts the week in Settings' summary", () => {
    expect(sectionsSummary([])).toEqual({ names: "Week, Suggestions, Macros, Foods today, Progress", count: "5 of 5" });
    expect(sectionsSummary(["foods"])).toEqual({ names: "Week, Suggestions, Macros, Progress", count: "4 of 5" });
    expect(sectionsSummary(["suggestions", "macros", "foods", "progress"])).toEqual({ names: "Week", count: "1 of 5" });
  });

  it("names the weight card for Progress on wider layouts", () => {
    const caption = (layout: Parameters<typeof sectionRows>[0]) => sectionRows(layout).find((row) => row.id === "progress")?.caption;
    expect(caption("phone")).toBe("Weight and intake charts");
    expect(caption("tablet")).toBe("The weight card");
    expect(caption("three")).toBe("The weight card and This week");
    expect(sectionRows("two").map((row) => row.id)).toEqual(HOME_SECTIONS.map((row) => row.id));
  });

  it("keeps only the hidden ids, so a new card shows until it's switched off", () => {
    const store = stubStorage({ [HOME_HIDDEN_KEY]: JSON.stringify(["progress", "removed", 3, "foods"]) });
    expect(readHiddenSections()).toEqual(["foods", "progress"]);
    writeHiddenSections(["macros"]);
    expect(store.get(HOME_HIDDEN_KEY)).toBe('["macros"]');
    writeHiddenSections([]);
    expect(store.has(HOME_HIDDEN_KEY)).toBe(false);
  });

  it("shows every card when storage is broken or holds junk", () => {
    stubStorage({ [HOME_HIDDEN_KEY]: "{not json" });
    expect(readHiddenSections()).toEqual([]);
    stubStorage({}, true);
    expect(readHiddenSections()).toEqual([]);
    expect(() => writeHiddenSections(["foods"])).not.toThrow();
  });
});
