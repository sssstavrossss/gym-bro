import { describe, expect, it } from "vitest";
import { dayNutrients, knownSum, formatNutrient, nutrientPercent, panelsForSize, referenceAmount, sodiumMg } from "../src/lib/nutrients";

describe("sodium", () => {
  it("uses the source sodium, otherwise salt divided by 2.5", () => {
    expect(sodiumMg(80, 1)).toBe(80);
    expect(sodiumMg(0, 1)).toBe(0);
    expect(sodiumMg(null, 1)).toBe(400);
    expect(sodiumMg(null, 0)).toBe(0);
    expect(sodiumMg(null, null)).toBeNull();
  });
});

describe("day totals", () => {
  it("adds what is known and counts an unknown value as 0", () => {
    expect(knownSum([])).toBeNull();
    expect(knownSum([null, undefined])).toBeNull();
    expect(knownSum([1, null])).toBe(1);
    expect(knownSum([0])).toBe(0);
    const day = dayNutrients([
      { salt: 1, nutrients: { vitaminC: 10 } },
      { salt: null, nutrients: { vitaminC: null } },
    ]);
    expect(day.sodium).toBe(400);
    expect(day.vitaminC).toBe(10);
    expect(day.iron).toBe(0);
    expect(dayNutrients([{ nutrients: { vitaminC: null } }]).vitaminC).toBe(0);
    expect(formatNutrient(0, "mg")).toBe("0 mg");
    expect(formatNutrient(null, "mg")).toBe("—");
  });
});

describe("NNR percents", () => {
  it("uses the adult table and hides thiamin without a kcal target", () => {
    expect(referenceAmount("vitaminA", "male", 40)).toBe(800);
    expect(referenceAmount("vitaminA", "female", 80)).toBe(650);
    expect(referenceAmount("iron", "female", 40)).toBe(15);
    expect(referenceAmount("iron", "female", 60)).toBe(8);
    expect(referenceAmount("sodium", "male", 30)).toBe(1500);
    expect(nutrientPercent("vitaminC", 110, "male", 30, 2500)).toBe(100);
    expect(nutrientPercent("thiamin", 1, "male", 30, null)).toBeNull();
    expect(nutrientPercent("thiamin", 1, "male", 30, 2390)).toBe(100);
    expect(nutrientPercent("niacin", 16, "female", 30, 2390)).toBe(100);
    expect(nutrientPercent("saturatedFat", 10, "male", 30, 2500)).toBeNull();
    expect(nutrientPercent("vitaminC", null, "male", 30, 2500)).toBeNull();
  });

  it("splits a long panel at the largest text size and hides an empty one", () => {
    const entries = [{ fat: 7, nutrients: { thiamin: 1, riboflavin: 1, niacin: 1, vitaminB6: 1, folate: 1, vitaminB12: 1, saturatedFat: 1 } }];
    const small = panelsForSize(entries, false);
    expect(small.map((panel) => panel.id)).toEqual(["fats", "vitamins"]);
    expect(small[0].keys[0]).toBe("fat");
    expect(small[0].indent).toEqual(["saturatedFat", "epaDha"]);
    expect(small[0].keys).toEqual(["fat", "saturatedFat", "monoFat", "polyFat", "transFat", "omega3", "epaDha", "omega6", "cholesterol"]);
    expect(small[1].grid).toBe(true);
    expect(small[1].title).toBe("Vitamins");
    const large = panelsForSize(entries, true);
    expect(large.map((panel) => panel.id)).toEqual(["fats-0", "fats-1", "vitamins-0", "vitamins-1", "vitamins-2"]);
    expect(large[0].keys).toEqual(["fat", "saturatedFat", "monoFat", "polyFat"]);
    expect(large[1].keys).toEqual(["transFat", "omega3", "epaDha", "cholesterol"]);
    expect(large[2].grid).toBe(false);
    expect(large[2].keys).toEqual(["vitaminA", "vitaminD", "vitaminE", "vitaminC"]);
    expect(large[3].keys).toEqual(["thiamin", "riboflavin", "niacin", "vitaminB6"]);
    expect(large[4].keys).toEqual(["folate", "vitaminB12"]);
    expect(panelsForSize([{ nutrients: {} }], false)).toEqual([]);
  });

  it("adds copper, starch and EPA + DHA where they fit and never adds a page", () => {
    const entries = [{ fat: 5, nutrients: { copper: 0.5, starch: 10, sodium: 100, epaDha: 0.2 } }];
    const home = panelsForSize(entries, false);
    expect(home.find((panel) => panel.id === "minerals")!.keys).toContain("copper");
    expect(home.find((panel) => panel.id === "carbs")!.keys).toEqual(["sugars", "addedSugars", "starch", "fiber", "sodium"]);
    expect(home.find((panel) => panel.id === "fats")!.keys).toHaveLength(9);
    // Largest text: the same pages as before (fats 2, carbs 1, minerals 2), the least important row drops.
    const large = panelsForSize(entries, true);
    const pages = (id: string) => large.filter((panel) => panel.id === id || panel.id.startsWith(`${id}-`));
    expect(pages("fats")).toHaveLength(2);
    expect(pages("carbs")).toHaveLength(1);
    expect(pages("carbs")[0].keys).not.toContain("starch");
    expect(pages("minerals")).toHaveLength(2);
    expect(pages("minerals").flatMap((panel) => panel.keys)).not.toContain("copper");
    expect(large.every((panel) => panel.keys.length <= 4)).toBe(true);
    expect(formatNutrient(0.04, "mg", true)).toBe("0.04 mg");
    expect(formatNutrient(0.69, "mg", true)).toBe("0.69 mg");
    expect(formatNutrient(0.5, "mg", true)).toBe("0.5 mg");
    expect(formatNutrient(1.234, "mg", true)).toBe("1.2 mg");
    expect(formatNutrient(0.04, "mg")).toBe("0 mg");
    expect(referenceAmount("copper", "female", 30)).toBe(0.9);
    expect(nutrientPercent("copper", 0.9, "male", 40, 2500)).toBe(100);
  });
});
