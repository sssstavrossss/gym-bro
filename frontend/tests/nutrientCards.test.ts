import { describe, expect, it } from "vitest";
import {
  carbBreakdown,
  carbLimits,
  sodiumLimitMg,
  sodiumLimitOf,
  coverageNote,
  daySources,
  fatBreakdown,
  fatLimits,
  fatLimitsOf,
  goalStatus,
  limitStatus,
  nutrientRing,
  panelCoverage,
  referenceText,
} from "../src/lib/nutrientCards";
import { nutrientName, nutrientNumber, referenceFor, upperLimit } from "../src/lib/nutrients";

const man = { sex: "male", age: 40, kcalTarget: 2390 };

describe("fat breakdown", () => {
  it("splits the known kinds and leaves the rest as not broken down", () => {
    const { total, parts } = fatBreakdown({ fat: 100, saturatedFat: 20.5, monoFat: 14.6, polyFat: 1.9, transFat: 0.2 });
    expect(total).toBe(100);
    expect(parts.map((part) => part.key)).toEqual(["saturatedFat", "monoFat", "polyFat", "transFat", "rest"]);
    expect(parts.at(-1)?.grams).toBeCloseTo(62.8, 5);
    expect(parts.at(-1)?.label).toBe("Not broken down");
  });

  it("never goes below zero when the kinds add up to more than the total", () => {
    const { parts } = fatBreakdown({ fat: 10, saturatedFat: 6, monoFat: 5 });
    expect(parts.at(-1)?.grams).toBe(0);
  });

  it("treats unknown and negative values as nothing", () => {
    const { total, parts } = fatBreakdown({ fat: null, saturatedFat: -1 });
    expect(total).toBe(0);
    expect(parts.every((part) => part.grams === 0)).toBe(true);
  });
});

describe("fat limits", () => {
  it("normal is 10% of the kcal target as saturated fat, with no cholesterol cap", () => {
    expect(fatLimits("normal", 1890)).toEqual({ setting: "normal", saturatedPercent: 10, saturatedGrams: 21, cholesterolMg: null });
  });

  it("lower is 7% and caps cholesterol at 200 mg", () => {
    expect(fatLimits("lower", 1890)).toEqual({ setting: "lower", saturatedPercent: 7, saturatedGrams: 14.7, cholesterolMg: 200 });
  });

  it("has no saturated grams without a kcal target", () => {
    expect(fatLimits("normal", null).saturatedGrams).toBeNull();
    expect(fatLimits("lower", 0).saturatedGrams).toBeNull();
  });

  it("reads an unknown setting as normal", () => {
    expect(fatLimitsOf("lower")).toBe("lower");
    expect(fatLimitsOf("strict")).toBe("normal");
    expect(fatLimitsOf(undefined)).toBe("normal");
  });

  it("reports how far over a limit a value is", () => {
    expect(limitStatus(20.5, 14.7)).toEqual({ fraction: 20.5 / 14.7, over: 20.5 - 14.7 });
    expect(limitStatus(10, 20)).toEqual({ fraction: 0.5, over: null });
    expect(limitStatus(20, 20).over).toBeNull();
    expect(limitStatus(5, 0)).toEqual({ fraction: 0, over: null });
  });
});

describe("carbs and sodium", () => {
  it("splits carbs into sugars, starch, and what is not broken down", () => {
    const { total, parts, addedSugars } = carbBreakdown(114, { sugars: 32.1, addedSugars: 4, starch: 20 });
    expect(total).toBe(114);
    expect(parts.map((part) => [part.key, part.label])).toEqual([["sugars", "Sugars"], ["starch", "Starch"], ["rest", "Not broken down"]]);
    expect(parts[2].grams).toBeCloseTo(61.9, 5);
    expect(addedSugars).toBe(4);
  });

  it("never goes below zero and treats unknown as nothing", () => {
    expect(carbBreakdown(10, { sugars: 8, starch: 5 }).parts[2].grams).toBe(0);
    const empty = carbBreakdown(Number.NaN, { sugars: null, starch: -1 });
    expect(empty.total).toBe(0);
    expect(empty.parts.every((part) => part.grams === 0)).toBe(true);
  });

  it("uses the Progress fibre minimum and keeps added sugars under 10% of the kcal target", () => {
    // 10% of 1884 kcal is 188.4 kcal of sugar: 47.1 g.
    expect(carbLimits({ sex: "male", kcalTarget: 1884 })).toEqual({ fibreGrams: 35, addedSugarsGrams: 47.1, sodiumMg: 2300 });
    expect(carbLimits({ sex: "female", kcalTarget: 1884 }).fibreGrams).toBe(25);
  });

  it("keeps the sodium limit without a sex or a kcal target", () => {
    expect(carbLimits({ sex: "", kcalTarget: null })).toEqual({ fibreGrams: null, addedSugarsGrams: null, sodiumMg: 2300 });
    expect(carbLimits({ sex: "male", kcalTarget: 0 }).addedSugarsGrams).toBeNull();
    // Strict sodium is 1,500 mg; anything unknown reads as the standard 2,300.
    expect(carbLimits({ sex: "male", kcalTarget: 1884, sodiumLimit: "lower" }).sodiumMg).toBe(1500);
    expect(sodiumLimitMg(sodiumLimitOf("lower"))).toBe(1500);
    expect(sodiumLimitMg(sodiumLimitOf("strict"))).toBe(2300);
    expect(sodiumLimitMg(undefined)).toBe(2300);
  });

  it("reports how far short of a minimum a value is", () => {
    expect(goalStatus(2.9, 35)).toEqual({ fraction: 2.9 / 35, toGo: 35 - 2.9 });
    expect(goalStatus(40, 35).toGo).toBeNull();
    expect(goalStatus(35, 35).toGo).toBeNull();
    expect(goalStatus(5, 0)).toEqual({ fraction: 0, toGo: null });
  });
});

describe("nutrient rings", () => {
  it("fills to the percent of the reference and is hit at 100", () => {
    const half = nutrientRing("vitaminC", 55, null, man);
    expect(half).toMatchObject({ label: "Vit C", name: "Vitamin C", amount: "55 mg", percent: 50, fill: 0.5, hit: false, overLimit: false, weekFill: null });
    const full = nutrientRing("vitaminC", 220, 110, man);
    expect(full).toMatchObject({ percent: 200, fill: 1, hit: true, weekFill: 1 });
  });

  it("flags a value above the upper limit", () => {
    expect(nutrientRing("iron", 41, null, man).overLimit).toBe(true);
    expect(nutrientRing("iron", 40, null, man).overLimit).toBe(false);
    // Vitamin C has no EU upper limit.
    expect(nutrientRing("vitaminC", 5000, null, man).overLimit).toBe(false);
  });

  it("has no percent without a reference for the person", () => {
    const ring = nutrientRing("vitaminC", 50, 40, { sex: "", age: 0, kcalTarget: null });
    expect(ring).toMatchObject({ percent: null, fill: 0, hit: false, weekFill: null });
  });

  it("uses the kcal target for thiamin", () => {
    // 2390 kcal is 10 MJ, so the reference is 1 mg.
    expect(nutrientRing("thiamin", 1.2, 0.6, man)).toMatchObject({ percent: 120, hit: true, weekFill: 0.6 });
  });
});

describe("coverage", () => {
  const entries = [
    { nutrients: { vitaminC: 10 } },
    { nutrients: { iron: 1 } },
    { nutrients: null },
  ];

  it("counts entries that know any of the keys", () => {
    expect(panelCoverage(entries, ["vitaminC", "vitaminD"])).toEqual({ known: 1, total: 3 });
    expect(panelCoverage(entries, ["vitaminC", "iron"])).toEqual({ known: 2, total: 3 });
  });

  it("only notes a panel that is missing foods", () => {
    expect(coverageNote({ known: 3, total: 5 })).toBe("from 3 of 5 foods");
    expect(coverageNote({ known: 5, total: 5 })).toBe("");
    expect(coverageNote({ known: 0, total: 0 })).toBe("");
  });
});

describe("day sources", () => {
  const entries = [
    { id: "a", name: "Apple", nutrients: { vitaminC: 10 } },
    { id: "b", name: "Kiwi", nutrients: { vitaminC: 90 } },
    { id: "c", name: "Bread", nutrients: { vitaminC: 0 } },
    { id: "d", name: "Quick add", nutrients: null },
    { id: "e", name: "Quick add", nutrients: null },
  ];

  it("ranks what gave the day its amount and lists entries without data once", () => {
    const sources = daySources(entries, "vitaminC", 110);
    expect(sources.rows.map((row) => row.name)).toEqual(["Kiwi", "Apple"]);
    expect(sources.rows[0].fraction).toBeCloseTo(90 / 110, 5);
    expect(sources.missing).toEqual(["Quick add"]);
  });

  it("scales bars to the largest source without a reference", () => {
    const sources = daySources(entries, "vitaminC", null);
    expect(sources.rows.map((row) => row.fraction)).toEqual([1, 10 / 90]);
  });
});

describe("references and names", () => {
  it("names a nutrient in full", () => {
    expect(nutrientName("thiamin")).toBe("Thiamin (B1)");
    expect(nutrientName("iron")).toBe("Iron");
  });

  it("gives the reference and the upper limit", () => {
    expect(referenceFor("thiamin", "male", 40, 2390)).toBeCloseTo(1, 5);
    expect(referenceFor("vitaminC", "female", 40, null)).toBe(95);
    expect(upperLimit("vitaminD")).toBe(100);
    expect(upperLimit("vitaminA")).toBeNull();
    expect(referenceText("iron", man)).toBe("reference 9 mg · upper limit 40 mg");
    expect(referenceText("vitaminC", man)).toBe("reference 110 mg");
  });

  it("formats a bare number with the same rounding", () => {
    expect(nutrientNumber(20.54)).toBe("20.5");
    expect(nutrientNumber(150.4)).toBe("150");
    expect(nutrientNumber(0.04, true)).toBe("0.04");
    expect(nutrientNumber(null)).toBe("—");
  });
});
