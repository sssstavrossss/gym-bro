import { round2 } from "./foodAmount";
import { int } from "./format";
import { kcalFromMacros } from "./macros";

/** What `POST` and `PUT /api/foods` accept for one private food. */
export interface CustomFoodWrite {
  name: string;
  brand: string | null;
  barcode: string | null;
  basis: "g" | "serving";
  nutrientBasis: "per_100" | "per_serving";
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  servingQuantity: number | null;
  servingLabel: string | null;
}

export interface CustomFoodForm {
  name: string;
  brand: string;
  barcode: string;
  basis: "100g" | "serving";
  servingGrams: string;
  servingName: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
}

export interface CustomFoodSeed {
  name?: string;
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
}

export interface StoredCustomFood {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  nutrientBasis: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  servingQuantity: number | null;
  servingLabel: string | null;
}

export interface CustomFoodPreview {
  mismatch: boolean;
  expectedKcal: number;
  emptyMacros: string[];
  /** Set when a serving weight is converted to per 100 g for storage. */
  per100: { kcal: number; protein: number; fat: number; carbs: number } | null;
  servingOnly: boolean;
}

export type CustomFoodBuild =
  | { ok: true; payload: CustomFoodWrite; preview: CustomFoodPreview }
  | { ok: false; field: "name" | "kcal" | "form"; message: string };

export const nameRequired = "Add a name to save this food.";
export const kcalRequired = "Calories are needed to save this food.";
export const duplicateNameNote = "You already have a food with this name — add a brand to tell them apart.";
export const servingOnlyNote = "No serving size: you'll log this food by serving only. Add the weight to log it in grams too.";
export const futureLogsNote = "Changes apply to future logs only. Past entries keep the values they were logged with.";

export function parseCustomNumber(raw: string): number {
  const text = raw.trim().replace(",", ".");
  if (!text || text === ".") return 0;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function sameNameCount(foods: { id: string; name: string }[], name: string, editId?: string | null): number {
  const key = name.trim().toLowerCase();
  if (!key) return 0;
  return foods.filter((food) => food.id !== editId && food.name.trim().toLowerCase() === key).length;
}

/** Gentle 4/9/4 hint. More than 20% off, and only when both sides are above zero. Never a reason to block save. */
export function macroHint(kcal: number, protein: number, fat: number, carbs: number): { mismatch: boolean; expectedKcal: number } {
  const expectedKcal = kcalFromMacros(protein, fat, carbs);
  const mismatch = kcal > 0 && expectedKcal > 0 && Math.abs(kcal - expectedKcal) / kcal > 0.2;
  return { mismatch, expectedKcal };
}

export function mismatchCopy(expectedKcal: number): string {
  return `Calories don't match the macros: P·F·C give about ${int(expectedKcal)} kcal. Worth checking the label — you can still save.`;
}

export function emptyMacroNote(names: string[]): string {
  if (!names.length) return "";
  return `Empty ${names.join(", ")} count${names.length === 1 ? "s" : ""} as 0 g.`;
}

export function savedPer100Copy(per100: { kcal: number; protein: number; fat: number; carbs: number }): string {
  return `Saved as ${per100.kcal} kcal · P${per100.protein} F${per100.fat} C${per100.carbs} per 100 g.`;
}

export function emptyForm(): CustomFoodForm {
  return {
    name: "",
    brand: "",
    barcode: "",
    basis: "100g",
    servingGrams: "",
    servingName: "serving",
    kcal: "",
    protein: "",
    fat: "",
    carbs: "",
  };
}

/** A quick-add seed is one serving of what was eaten. A name alone still starts on per serving, with no invented nutrients. */
export function formFromSeed(seed?: CustomFoodSeed | null): CustomFoodForm {
  const form = emptyForm();
  if (!seed) return form;
  form.basis = "serving";
  form.name = seed.name ?? "";
  form.kcal = seed.kcal ? String(seed.kcal) : "";
  form.protein = seed.protein ? String(seed.protein) : "";
  form.fat = seed.fat ? String(seed.fat) : "";
  form.carbs = seed.carbs ? String(seed.carbs) : "";
  return form;
}

export function formFromFood(food: StoredCustomFood): CustomFoodForm {
  const perServing = food.nutrientBasis === "per_serving";
  return {
    name: food.name,
    brand: food.brand ?? "",
    barcode: food.barcode ?? "",
    basis: perServing ? "serving" : "100g",
    servingGrams: !perServing && food.servingQuantity ? String(food.servingQuantity) : "",
    servingName: food.servingLabel || "serving",
    kcal: food.kcalPer100 ? String(food.kcalPer100) : "",
    protein: food.proteinPer100 ? String(food.proteinPer100) : "",
    fat: food.fatPer100 ? String(food.fatPer100) : "",
    carbs: food.carbsPer100 ? String(food.carbsPer100) : "",
  };
}

function blank(raw: string): boolean {
  return raw.trim() === "";
}

function per100Limits(kcal: number, protein: number, fat: number, carbs: number): string | null {
  if (kcal < 0 || kcal > 1200) return "Calories per 100 should be between 0 and 1,200.";
  if (protein < 0 || fat < 0 || carbs < 0 || protein > 100 || fat > 100 || carbs > 100) {
    return "Protein, fat, and carbs per 100 should be between 0 and 100 g.";
  }
  return null;
}

function servingLimits(kcal: number, protein: number, fat: number, carbs: number): string | null {
  if (kcal < 0 || kcal > 10000) return "Calories per serving should be between 0 and 10,000.";
  if (protein < 0 || fat < 0 || carbs < 0 || protein > 1000 || fat > 1000 || carbs > 1000) {
    return "Protein, fat, and carbs per serving should be between 0 and 1,000 g.";
  }
  return null;
}

/**
 * Turn the editor into the API body.
 * A serving weight on a new food is stored per 100 g.
 * A serving-only food stays per serving, with no gram weight.
 * Adding a weight to a food that is already per serving sends the per-serving numbers;
 * the server converts future logs and leaves old rows alone.
 */
export function buildCustomFood(form: CustomFoodForm, options: { editingPerServing: boolean }): CustomFoodBuild {
  const name = form.name.trim();
  if (!name || name.length > 200) return { ok: false, field: "name", message: nameRequired };

  const brand = form.brand.trim();
  if (brand.length > 80) return { ok: false, field: "form", message: "Brand should be 80 characters or fewer." };

  const barcode = form.barcode.trim();
  if (barcode && (barcode.length > 32 || !/^\d+$/.test(barcode))) {
    return { ok: false, field: "form", message: "A barcode should be digits only." };
  }

  const kcalText = form.kcal.trim();
  const kcal = parseCustomNumber(form.kcal);
  if (!kcalText || !Number.isFinite(kcal) || kcal <= 0) return { ok: false, field: "kcal", message: kcalRequired };

  const protein = blank(form.protein) ? 0 : parseCustomNumber(form.protein);
  const fat = blank(form.fat) ? 0 : parseCustomNumber(form.fat);
  const carbs = blank(form.carbs) ? 0 : parseCustomNumber(form.carbs);
  if (![protein, fat, carbs].every((value) => Number.isFinite(value))) {
    return { ok: false, field: "form", message: "Protein, fat, and carbs should be numbers." };
  }

  const gramsText = form.servingGrams.trim();
  const grams = gramsText ? parseCustomNumber(form.servingGrams) : 0;
  if (gramsText && (!Number.isFinite(grams) || grams < 0 || grams > 5000)) {
    return { ok: false, field: "form", message: "Serving and piece sizes should be between 0 and 5,000." };
  }

  const servingName = form.servingName.trim() || "serving";
  if (servingName.length > 80) {
    return { ok: false, field: "form", message: "Serving and piece labels should be 80 characters or fewer." };
  }

  const emptyMacros = (["protein", "fat", "carbs"] as const).filter((key) => blank(form[key]));
  const hint = macroHint(kcal, protein, fat, carbs);
  const hasWeight = grams > 0;
  const scale = (value: number) => round2((value * 100) / grams);
  const base = {
    name,
    brand: brand || null,
    barcode: barcode || null,
  };

  if (form.basis === "serving" && hasWeight && options.editingPerServing) {
    const limit = servingLimits(kcal, protein, fat, carbs);
    if (limit) return { ok: false, field: "form", message: limit };
    return {
      ok: true,
      payload: {
        ...base,
        basis: "serving",
        nutrientBasis: "per_serving",
        kcalPer100: kcal,
        proteinPer100: protein,
        fatPer100: fat,
        carbsPer100: carbs,
        servingQuantity: grams,
        servingLabel: servingName,
      },
      preview: {
        ...hint,
        emptyMacros,
        per100: { kcal: scale(kcal), protein: scale(protein), fat: scale(fat), carbs: scale(carbs) },
        servingOnly: false,
      },
    };
  }

  if (form.basis === "serving" && hasWeight) {
    const per100 = { kcal: scale(kcal), protein: scale(protein), fat: scale(fat), carbs: scale(carbs) };
    const limit = per100Limits(per100.kcal, per100.protein, per100.fat, per100.carbs);
    if (limit) return { ok: false, field: "form", message: limit };
    return {
      ok: true,
      payload: {
        ...base,
        basis: "g",
        nutrientBasis: "per_100",
        kcalPer100: per100.kcal,
        proteinPer100: per100.protein,
        fatPer100: per100.fat,
        carbsPer100: per100.carbs,
        servingQuantity: grams,
        servingLabel: servingName,
      },
      preview: { ...hint, emptyMacros, per100, servingOnly: false },
    };
  }

  if (form.basis === "serving") {
    const limit = servingLimits(kcal, protein, fat, carbs);
    if (limit) return { ok: false, field: "form", message: limit };
    return {
      ok: true,
      payload: {
        ...base,
        basis: "serving",
        nutrientBasis: "per_serving",
        kcalPer100: kcal,
        proteinPer100: protein,
        fatPer100: fat,
        carbsPer100: carbs,
        servingQuantity: null,
        servingLabel: servingName,
      },
      preview: { ...hint, emptyMacros, per100: null, servingOnly: true },
    };
  }

  const limit = per100Limits(kcal, protein, fat, carbs);
  if (limit) return { ok: false, field: "form", message: limit };
  return {
    ok: true,
    payload: {
      ...base,
      basis: "g",
      nutrientBasis: "per_100",
      kcalPer100: kcal,
      proteinPer100: protein,
      fatPer100: fat,
      carbsPer100: carbs,
      servingQuantity: hasWeight ? grams : null,
      servingLabel: hasWeight ? servingName : null,
    },
    preview: { ...hint, emptyMacros, per100: null, servingOnly: false },
  };
}

/** Quick Add checkbox: one serving, no gram weight, private. */
export function quickAddFoodWrite(input: { name: string; kcal: number; protein: number; fat: number; carbs: number }): CustomFoodBuild {
  return buildCustomFood({
    name: input.name,
    brand: "",
    barcode: "",
    basis: "serving",
    servingGrams: "",
    servingName: "serving",
    kcal: input.kcal > 0 ? String(input.kcal) : "",
    protein: input.protein ? String(input.protein) : "",
    fat: input.fat ? String(input.fat) : "",
    carbs: input.carbs ? String(input.carbs) : "",
  }, { editingPerServing: false });
}
