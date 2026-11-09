import { describe, expect, it } from "vitest";
import type { CatalogFood } from "../src/lib/foodAmount";
import {
  amountForRecent,
  beginOffRequest,
  canAskOpenFoodFacts,
  finishOffRequest,
  idleOff,
  isMyFood,
  missingKcalEditorSeed,
  missingKcalNotice,
  myFoodsEmptyDetail,
  myFoodsEmptyTitle,
  offFailureCopy,
  withBrand,
  packagedBesideLocal,
  quickAddName,
  recentAddBody,
  recentEmptyDetail,
  recentEmptyTitle,
  recentSubtitle,
  typeForLocalSearch,
} from "../src/lib/foodSheet";

const oats: CatalogFood = {
  id: "oats",
  source: "mvt",
  name: "Fictional oats",
  nameEn: null,
  basis: "g",
  nutrientBasis: "per_100",
  kcalPer100: 165,
  proteinPer100: 13,
  fatPer100: 7,
  carbsPer100: 14,
  servingQuantity: 40,
  servingLabel: "serving",
  pieceQuantity: null,
  pieceLabel: null,
};

const base = {
  foodId: "oats",
  name: "Fictional oats",
  amount: 180,
  unit: "g",
  kcal: 297,
  protein: 23.4,
  fat: 12.6,
  carbs: 25.2,
  timeZone: "Europe/Oslo",
  idempotencyKey: "key-1",
};

describe("recents", () => {
  it("one tap on today logs the last amount and unit and does not invent a clock time", () => {
    const result = recentAddBody({ ...base, date: "2026-11-09", today: "2026-11-09", pickedTime: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.foodId).toBe("oats");
    expect(result.body.amount).toBe(180);
    expect(result.body.unit).toBe("g");
    expect(result.body.time).toBeNull();
    expect(result.body.localDate).toBe("2026-11-09");
    expect(result.body.kcal).toBe(297);
  });

  it("keeps a time the person already picked today", () => {
    const result = recentAddBody({ ...base, date: "2026-11-09", today: "2026-11-09", pickedTime: "07:30" });
    expect(result.ok && result.body.time).toBe("07:30");
  });

  it("a past day does not default the time to now", () => {
    const blocked = recentAddBody({ ...base, date: "2026-11-08", today: "2026-11-09", pickedTime: null });
    expect(blocked).toEqual({ ok: false, needTime: true });
    const picked = recentAddBody({ ...base, date: "2026-11-08", today: "2026-11-09", pickedTime: "08:15" });
    expect(picked.ok && picked.body.time).toBe("08:15");
    expect(picked.ok && picked.body.amount).toBe(180);
    expect(picked.ok && picked.body.unit).toBe("g");
  });

  it("shows the last amount and unit on the row", () => {
    expect(amountForRecent(oats, 180, "g")).toEqual({ amount: "180", unit: "g" });
    expect(recentSubtitle(oats, 180, "g")).toBe("180 g · 297 kcal · P23.4 F12.6 C25.2");
    expect(recentSubtitle(oats, 1, "serving")).toBe("1 serving (40 g) · 66 kcal · P5.2 F2.8 C5.6");
    expect(recentEmptyTitle).toBe("Nothing here yet");
    expect(recentEmptyDetail).toContain("last amount");
  });
});

describe("Open Food Facts on demand", () => {
  it("searches local foods while typing and calls Open Food Facts only when asked", () => {
    const typed = typeForLocalSearch(idleOff(), "skyr");
    expect(typed.status).toBe("idle");
    expect(typed.results).toEqual([]);
    expect(canAskOpenFoodFacts("s")).toBe(false);
    expect(beginOffRequest(typeForLocalSearch(idleOff(), "s"))).toBeNull();
    const asked = beginOffRequest(typed);
    expect(asked?.status).toBe("loading");
    expect(asked?.query).toBe("skyr");
  });

  it("keeps the typed query when the outside search fails", () => {
    const loading = beginOffRequest(typeForLocalSearch(idleOff<{ id: string }>(), "skyr"));
    expect(loading).not.toBeNull();
    const failed = finishOffRequest(loading!, {
      query: "skyr",
      status: "rate_limited",
      missingKcal: 4,
      results: [{ id: "x" }],
    });
    expect(failed.query).toBe("skyr");
    expect(failed.status).toBe("rate_limited");
    expect(failed.results).toEqual([]);
    expect(failed.missingKcal).toBe(0);
    const down = finishOffRequest({ ...loading!, status: "loading" }, {
      query: "skyr",
      status: "unavailable",
      missingKcal: 0,
      results: [],
    });
    expect(down.query).toBe("skyr");
    expect(offFailureCopy("rate_limited")).toEqual(offFailureCopy("unavailable"));
    expect(offFailureCopy("unavailable").retry).toBe("Try again");
    expect(offFailureCopy("unavailable").quickAdd).toBe("Quick Add instead");
    expect(offFailureCopy("rate_limited").title).toBe("Can't reach the food database");
  });

  it("ignores a late outside response after the query changed", () => {
    const started = beginOffRequest(typeForLocalSearch(idleOff<{ id: string }>(), "skyr"));
    if (!started) throw new Error("expected a request");
    const next = typeForLocalSearch(started, "skyrr");
    const late = finishOffRequest(next, { query: "skyr", status: "ok", missingKcal: 1, results: [{ id: "old" }] });
    expect(late.query).toBe("skyrr");
    expect(late.status).toBe("idle");
    expect(late.results).toEqual([]);
  });

  it("keeps local rows and reports products skipped for missing calories", () => {
    const local = [{ id: "local-1" }];
    const beside = packagedBesideLocal(local, [{ id: "local-1" }, { id: "off-1" }, { id: "" }]);
    expect(beside).toEqual([{ id: "off-1" }]);
    const done = finishOffRequest(beginOffRequest(typeForLocalSearch(idleOff<{ id: string }>(), "bar"))!, {
      query: "bar",
      status: "ok",
      missingKcal: 2,
      results: beside,
    });
    expect(done.status).toBe("ok");
    expect(done.missingKcal).toBe(2);
    expect(done.results).toEqual([{ id: "off-1" }]);
    expect(done.query).toBe("bar");
    expect(missingKcalNotice).toBe("Not shown: missing calories → create my food");
    expect(quickAddName("", "bar")).toBe("bar");
    expect(quickAddName("Already named", "bar")).toBe("Already named");
    expect(missingKcalEditorSeed("  skyr bar  ")).toEqual({ name: "skyr bar" });
    expect(Object.keys(missingKcalEditorSeed("skyr bar") ?? {})).toEqual(["name"]);
    expect(missingKcalEditorSeed("   ")).toBeNull();
  });
});

describe("my foods", () => {
  it("marks an owned food and keeps the brand beside the detail", () => {
    expect(isMyFood({ source: "custom", owned: true })).toBe(true);
    expect(isMyFood({ source: "mvt" })).toBe(false);
    expect(withBrand("Northbar", "per serving · 180 kcal · P20 F4 C8")).toBe("Northbar · per serving · 180 kcal · P20 F4 C8");
    expect(withBrand(null, "per 100 g · 100 kcal · P1 F1 C1")).toBe("per 100 g · 100 kcal · P1 F1 C1");
    expect(myFoodsEmptyTitle).toBe("No foods of your own yet");
    expect(myFoodsEmptyDetail).toContain("Only you see them");
  });
});
