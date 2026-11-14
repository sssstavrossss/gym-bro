import { describe, expect, it } from "vitest";
import { completeSum, dayNutrients, formatNutrient, nutrientPercent, panelsForSize, referenceAmount, sodiumMg } from "../src/lib/nutrients";

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
  it("stays null when any entry is missing the nutrient", () => {
    expect(completeSum([])).toBeNull();
    expect(completeSum([1, null])).toBeNull();
    expect(completeSum([0])).toBe(0);
    const day = dayNutrients([
      { salt: 1, nutrients: { vitaminC: 10 } },
      { salt: null, nutrients: { vitaminC: null } },
    ]);
    expect(day.sodium).toBeNull();
    expect(day.vitaminC).toBeNull();
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
    expect(small.map((panel) => panel.id)).toEqual(["fats", "b"]);
    expect(small[0].keys[0]).toBe("fat");
    expect(small[0].indent).toEqual(["saturatedFat"]);
    const large = panelsForSize(entries, true);
    expect(large.map((panel) => panel.id)).toEqual(["fats-0", "fats-1", "b-0", "b-4"]);
    expect(large[0].keys).toEqual(["fat", "saturatedFat", "monoFat", "polyFat"]);
    expect(panelsForSize([{ nutrients: {} }], false)).toEqual([]);
  });
});
