import { describe, expect, it } from "vitest";
import {
  buildCustomFood,
  duplicateNameNote,
  emptyForm,
  emptyMacroNote,
  formFromFood,
  formFromSeed,
  kcalRequired,
  macroHint,
  mismatchCopy,
  nameRequired,
  quickAddFoodWrite,
  sameNameCount,
  savedPer100Copy,
  servingOnlyNote,
} from "../src/lib/customFood";

const named = (name: string, brand = "", extra: Partial<Parameters<typeof buildCustomFood>[0]> = {}) => ({
  ...emptyForm(),
  name,
  brand,
  kcal: "200",
  protein: "20",
  fat: "5",
  carbs: "10",
  ...extra,
});

describe("custom food editor", () => {
  it("saves a quick add as a per-serving food that search can find by name", () => {
    const built = quickAddFoodWrite({ name: "Desk shake", kcal: 220, protein: 30, fat: 4, carbs: 8 });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toMatchObject({
      name: "Desk shake",
      brand: null,
      nutrientBasis: "per_serving",
      basis: "serving",
      kcalPer100: 220,
      proteinPer100: 30,
      fatPer100: 4,
      carbsPer100: 8,
      servingQuantity: null,
      servingLabel: "serving",
    });
    expect(built.preview.servingOnly).toBe(true);
    expect(servingOnlyNote).toContain("by serving only");
  });

  it("does not block save when calories are more than 20% off 4/9/4", () => {
    const hint = macroHint(100, 1, 1, 1);
    expect(hint.mismatch).toBe(true);
    expect(hint.expectedKcal).toBe(17);
    expect(mismatchCopy(hint.expectedKcal)).toContain("you can still save");
    const built = buildCustomFood(named("Odd bar", "", { basis: "100g", kcal: "100", protein: "1", fat: "1", carbs: "1" }), { editingPerServing: false });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.kcalPer100).toBe(100);
    expect(built.preview.mismatch).toBe(true);
    expect(macroHint(100, 20, 0, 0).mismatch).toBe(false);
  });

  it("requires calories and stores blank macros as zero", () => {
    const missing = buildCustomFood(named("Soup", "", { kcal: "" }), { editingPerServing: false });
    expect(missing).toEqual({ ok: false, field: "kcal", message: kcalRequired });
    const unnamed = buildCustomFood(named("  ", "", { kcal: "10" }), { editingPerServing: false });
    expect(unnamed).toEqual({ ok: false, field: "name", message: nameRequired });
    const zeros = buildCustomFood(named("Broth", "", { basis: "100g", kcal: "15", protein: "", fat: "", carbs: "" }), { editingPerServing: false });
    expect(zeros.ok).toBe(true);
    if (!zeros.ok) return;
    expect(zeros.payload.proteinPer100).toBe(0);
    expect(zeros.payload.fatPer100).toBe(0);
    expect(zeros.payload.carbsPer100).toBe(0);
    expect(emptyMacroNote(zeros.preview.emptyMacros)).toBe("Empty protein, fat, carbs count as 0 g.");
  });

  it("stores a weighed serving per 100 g and leaves a serving-only edit for the server to scale", () => {
    const created = buildCustomFood(named("Bar", "Northbar", { basis: "serving", servingGrams: "50", kcal: "200" }), { editingPerServing: false });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.payload.nutrientBasis).toBe("per_100");
    expect(created.payload.kcalPer100).toBe(400);
    expect(created.payload.servingQuantity).toBe(50);
    expect(created.payload.brand).toBe("Northbar");
    expect(savedPer100Copy(created.preview.per100!)).toContain("400 kcal");

    const later = buildCustomFood(named("Bar", "Northbar", { basis: "serving", servingGrams: "50", kcal: "200" }), { editingPerServing: true });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.payload.nutrientBasis).toBe("per_serving");
    expect(later.payload.kcalPer100).toBe(200);
    expect(later.payload.servingQuantity).toBe(50);
    expect(later.preview.per100?.kcal).toBe(400);
  });

  it("allows the same name twice and starts a missing-calorie notice from the name only", () => {
    const foods = [
      { id: "a", name: "Protein bar, cookie" },
      { id: "b", name: "Protein bar, cookie" },
    ];
    expect(sameNameCount(foods, "protein bar, cookie", "a")).toBe(1);
    expect(duplicateNameNote).toContain("add a brand");
    const seed = formFromSeed({ name: "Skipped product" });
    expect(seed.name).toBe("Skipped product");
    expect(seed.kcal).toBe("");
    expect(seed.protein).toBe("");
    expect(seed.fat).toBe("");
    expect(seed.carbs).toBe("");
    expect(seed.basis).toBe("serving");
    const fromQuick = formFromSeed({ name: "Desk shake", kcal: 220, protein: 30, fat: 4, carbs: 8 });
    expect(fromQuick.kcal).toBe("220");
    expect(fromQuick.basis).toBe("serving");
    const stored = formFromFood({
      name: "Bar",
      brand: "Fitbake",
      barcode: "200",
      nutrientBasis: "per_serving",
      kcalPer100: 180,
      proteinPer100: 20,
      fatPer100: 4,
      carbsPer100: 8,
      servingQuantity: null,
      servingLabel: "bar",
    });
    expect(stored.basis).toBe("serving");
    expect(stored.servingGrams).toBe("");
    expect(stored.brand).toBe("Fitbake");
    expect(stored.servingName).toBe("bar");
  });

  it("accepts a comma and rejects a barcode that is not digits", () => {
    const comma = buildCustomFood(named("Soup", "", { basis: "100g", kcal: "12,5", protein: "1,5", fat: "0", carbs: "1" }), { editingPerServing: false });
    expect(comma.ok).toBe(true);
    if (!comma.ok) return;
    expect(comma.payload.kcalPer100).toBe(12.5);
    expect(comma.payload.proteinPer100).toBe(1.5);
    const barcode = buildCustomFood(named("Soup", "", { barcode: "12ab" }), { editingPerServing: false });
    expect(barcode.ok).toBe(false);
  });
});
