import { afterEach, describe, expect, it, vi } from "vitest";
import { followPage, HIDDEN_KEYS, isDefaultOrder, MACRO_PAGES, movePage, orderPages, pageRows, parseHidden, readHidden, toggleHidden, visiblePages, writeHidden } from "../src/lib/cardPages";
import { PROGRESS_PAGES } from "../src/lib/progressCard";

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

describe("card pages", () => {
  it("shows every page but the hidden ones, and never hides the first", () => {
    expect(visiblePages(PROGRESS_PAGES, [])).toEqual([...PROGRESS_PAGES]);
    expect(visiblePages(PROGRESS_PAGES, ["weight", "fat", "carbs"])).toEqual(["weight", "kcal", "protein", "fiber", "saturatedFat", "sodium", "burn"]);
    expect(visiblePages(MACRO_PAGES, ["vitamins", "minerals"])).toEqual(["macros", "fats", "carbs"]);
  });

  it("puts the pages in the saved order, a hidden page keeping its place", () => {
    const order = ["burn", "kcal", "weight", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"];
    expect(orderPages(PROGRESS_PAGES, order)).toEqual(order);
    expect(visiblePages(PROGRESS_PAGES, ["fat", "kcal"], order)).toEqual(["burn", "weight", "protein", "carbs", "fiber", "saturatedFat", "sodium"]);
    // Weight moves but still never hides.
    expect(visiblePages(PROGRESS_PAGES, ["weight"], movePage(PROGRESS_PAGES, [], "kcal", 0)).slice(0, 2)).toEqual(["kcal", "weight"]);
  });

  it("slots a page the order doesn't name after its default neighbour, and drops unknown ids", () => {
    // Saved before Burn existed: Burn follows Sodium wherever Sodium went.
    expect(orderPages(PROGRESS_PAGES, ["sodium", "weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat"])).toEqual(["sodium", "burn", "weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat"]);
    expect(orderPages(MACRO_PAGES, ["minerals", "macros", "gone", "fats", "carbs", "minerals"])).toEqual(["minerals", "macros", "fats", "carbs", "vitamins"]);
    expect(orderPages(MACRO_PAGES, [])).toEqual([...MACRO_PAGES]);
  });

  it("moves a page, and saves the default order as empty", () => {
    const moved = movePage(PROGRESS_PAGES, [], "burn", 1);
    expect(moved).toEqual(["weight", "burn", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium"]);
    expect(isDefaultOrder(PROGRESS_PAGES, moved)).toBe(false);
    expect(movePage(PROGRESS_PAGES, moved, "burn", 99)).toEqual([]);
    expect(movePage(MACRO_PAGES, [], "macros", 2)).toEqual(["fats", "carbs", "macros", "vitamins", "minerals"]);
    expect(isDefaultOrder(MACRO_PAGES, [])).toBe(true);
  });

  it("switches a page off and on, in the card's order, and ignores the first page", () => {
    let hidden = toggleHidden(PROGRESS_PAGES, [], "sodium", false);
    hidden = toggleHidden(PROGRESS_PAGES, hidden, "fat", false);
    expect(hidden).toEqual(["fat", "sodium"]);
    expect(toggleHidden(PROGRESS_PAGES, hidden, "fat", true)).toEqual(["sodium"]);
    expect(toggleHidden(PROGRESS_PAGES, hidden, "weight", false)).toEqual(["fat", "sodium"]);
    // An id that's no longer a page drops out.
    expect(toggleHidden(PROGRESS_PAGES, ["gone", "fat"], "kcal", false)).toEqual(["kcal", "fat"]);
  });

  it("keeps the card on the same page, or goes to the first when that page hides", () => {
    expect(followPage("fiber", ["weight", "kcal", "fiber"])).toBe(2);
    expect(followPage("fat", ["weight", "kcal", "fiber"])).toBe(0);
    expect(followPage(undefined, ["weight"])).toBe(0);
  });

  it("reads and saves the hidden list on this device", () => {
    const store = stubStorage({ [HIDDEN_KEYS.progress]: '["fat",3,"sodium"]' });
    expect(readHidden("progress")).toEqual(["fat", "sodium"]);
    expect(readHidden("macros")).toEqual([]);
    writeHidden("macros", ["vitamins"]);
    expect(store.get(HIDDEN_KEYS.macros)).toBe('["vitamins"]');
    writeHidden("macros", []);
    expect(store.has(HIDDEN_KEYS.macros)).toBe(false);
    expect(parseHidden("{bad")).toEqual([]);
    expect(parseHidden('{"fat":true}')).toEqual([]);
  });

  it("shows every page when storage is blocked", () => {
    stubStorage({}, true);
    expect(readHidden("progress")).toEqual([]);
    expect(() => writeHidden("progress", ["fat"])).not.toThrow();
  });

  it("names each page in the sheet, with the first always shown", () => {
    const progress = pageRows("progress");
    expect(progress.map((row) => row.id)).toEqual([...PROGRESS_PAGES]);
    expect(progress.map((row) => row.caption)).toEqual(["Always shown", "Target ±10%", "Minimum", "Target ±10%", "Target ±10%", "Minimum", "Limit", "Limit", "Daily burn and BMR"]);
    const macros = pageRows("macros");
    expect(macros.map((row) => row.title)).toEqual(["Macros", "Fats", "Carbs & sodium", "Vitamins", "Minerals"]);
    expect(macros.map((row) => row.caption).slice(3)).toEqual(["10 vitamins", "9 minerals"]);
  });
});
