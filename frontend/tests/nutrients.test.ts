import { describe, expect, it } from "vitest";
import { dayNutrients, foodSource, knownSum, scaleSource, formatNutrient, nutrientPercent, panelsForSize, referenceAmount, sodiumMg } from "../src/lib/nutrients";

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

  it("shows every panel, and splits a long one at the largest text size", () => {
    const small = panelsForSize(false);
    expect(small.map((panel) => panel.id)).toEqual(["fats", "carbs", "vitamins", "minerals"]);
    expect(small[0].keys[0]).toBe("fat");
    expect(small[0].indent).toEqual(["saturatedFat", "epaDha"]);
    expect(small[0].keys).toEqual(["fat", "saturatedFat", "monoFat", "polyFat", "transFat", "omega3", "epaDha", "omega6", "cholesterol"]);
    expect(small[2].grid).toBe(true);
    expect(small[2].title).toBe("Vitamins");
    const large = panelsForSize(true);
    const vitamins = large.filter((panel) => panel.id.startsWith("vitamins-"));
    expect(large.filter((panel) => panel.id.startsWith("fats-")).map((panel) => panel.keys)).toEqual([
      ["fat", "saturatedFat", "monoFat", "polyFat"],
      ["transFat", "omega3", "epaDha", "cholesterol"],
    ]);
    expect(vitamins.map((panel) => panel.id)).toEqual(["vitamins-0", "vitamins-1", "vitamins-2"]);
    expect(vitamins[0].grid).toBe(false);
    expect(vitamins[0].keys).toEqual(["vitaminA", "vitaminD", "vitaminE", "vitaminC"]);
    expect(vitamins[1].keys).toEqual(["thiamin", "riboflavin", "niacin", "vitaminB6"]);
    expect(vitamins[2].keys).toEqual(["folate", "vitaminB12"]);
  });

  it("leaves out hidden panels, with every page of a split one", () => {
    expect(panelsForSize(false, ["vitamins"]).map((panel) => panel.id)).toEqual(["fats", "carbs", "minerals"]);
    expect(panelsForSize(true, ["vitamins", "fats"]).map((panel) => panel.id)).toEqual(["carbs", "minerals-0", "minerals-1"]);
  });

  it("adds copper, starch and EPA + DHA where they fit and never adds a page", () => {
    const home = panelsForSize(false);
    expect(home.find((panel) => panel.id === "minerals")!.keys).toContain("copper");
    expect(home.find((panel) => panel.id === "carbs")!.keys).toEqual(["sugars", "addedSugars", "starch", "fiber", "sodium"]);
    expect(home.find((panel) => panel.id === "fats")!.keys).toHaveLength(9);
    // Largest text: the same pages as before (fats 2, carbs 1, minerals 2), the least important row drops.
    const large = panelsForSize(true);
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

describe("sources", () => {
  it("reads a food's per-100 panel and scales it, keeping unknowns unknown", () => {
    const source = foodSource({ fatPer100: 10, saturatedFatPer100: 3, sugarsPer100: null, saltPer100: 1, nutrients: { iron: 2, zinc: null } });
    expect(source).toEqual({ fat: 10, saturatedFat: 3, sugars: null, fiber: undefined, salt: 1, nutrients: { iron: 2, zinc: null } });
    expect(scaleSource(source, 1.5)).toEqual({ fat: 15, saturatedFat: 4.5, sugars: null, fiber: null, salt: 1.5, nutrients: { iron: 3, zinc: null } });
    expect(scaleSource({}, 2)).toEqual({ fat: null, saturatedFat: null, sugars: null, fiber: null, salt: null, nutrients: null });
  });
});
