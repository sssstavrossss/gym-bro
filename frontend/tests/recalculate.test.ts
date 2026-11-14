import { describe, expect, it } from "vitest";
import { bannerVisible, excludedDates, unreadCount, withExclusions, type ReviewDay } from "../src/lib/recalculate";

const days: ReviewDay[] = [
  { date: "2026-11-01", kcal: 1000, targetKcal: 2200, fasting: false, canExclude: true, included: true },
  { date: "2026-11-02", kcal: 1800, targetKcal: 2200, fasting: false, canExclude: false, included: true },
];

describe("recalculate banner", () => {
  it("stays up through the week until a recalculation or a dismissal", () => {
    expect(bannerVisible(false, false)).toBe(true);
    expect(bannerVisible(true, false)).toBe(false);
    expect(bannerVisible(false, true)).toBe(false);
    expect(unreadCount([{ readAt: null }, { readAt: "2026-11-10T00:00:00Z" }])).toBe(1);
  });
});

describe("recalculate exclusions", () => {
  it("starts with every listed day included", () => {
    expect(excludedDates(days, new Set())).toEqual([]);
    expect(withExclusions(days, new Set()).every((day) => day.included)).toBe(true);
  });

  it("excludes only a ticked day that can be excluded", () => {
    const ticked = new Set(["2026-11-01", "2026-11-02"]);
    expect(excludedDates(days, ticked)).toEqual(["2026-11-01"]);
    const next = withExclusions(days, ticked);
    expect(next[0].included).toBe(false);
    expect(next[1].included).toBe(true);
  });
});
