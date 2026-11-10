import { describe, expect, it } from "vitest";
import { excludedDates, withExclusions, type ReviewDay } from "../src/lib/recalculate";

const days: ReviewDay[] = [
  { date: "2026-11-01", kcal: 1000, targetKcal: 2200, fasting: false, canExclude: true, included: true },
  { date: "2026-11-02", kcal: 0, targetKcal: 2200, fasting: true, canExclude: false, included: true },
];

describe("recalculate exclusions", () => {
  it("starts with every listed day included", () => {
    expect(excludedDates(days, new Set())).toEqual([]);
    expect(withExclusions(days, new Set()).every((day) => day.included)).toBe(true);
  });

  it("excludes only a ticked under-target day and keeps fasting", () => {
    const ticked = new Set(["2026-11-01", "2026-11-02"]);
    expect(excludedDates(days, ticked)).toEqual(["2026-11-01"]);
    const next = withExclusions(days, ticked);
    expect(next[0].included).toBe(false);
    expect(next[1].included).toBe(true);
    expect(next[1].fasting).toBe(true);
  });
});
