import { formatDecimal, roundHalfAwayFromZero } from "./format";

/** A food row from `GET /api/foods/search` or `GET /api/foods/{id}`. */
export interface CatalogFood {
  id: string;
  source: string;
  name: string;
  nameEn: string | null;
  basis: string;
  nutrientBasis: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  servingQuantity: number | null;
  servingLabel: string | null;
  pieceQuantity: number | null;
  pieceLabel: string | null;
}

export interface UnitChoice {
  unit: "g" | "ml" | "serving" | "piece";
  /** Chip text. The value sent to the API is `unit`, not this label. */
  label: string;
  /** Grams in one of this unit. Null for a per-serving food. */
  gramsEach: number | null;
}

export interface MacroPreview {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  grams: number | null;
}

export interface StoredEntry {
  amount: number;
  unit: string;
  grams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

const PLURAL: Record<string, string> = { piece: "pieces", serving: "servings" };

export function round2(value: number): number {
  return roundHalfAwayFromZero(value, 2);
}

export function parseAmount(raw: string): number {
  const text = raw.trim().replace(",", ".");
  if (!text || text === ".") return 0;
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

export function normalizeUnit(unit: string): UnitChoice["unit"] | null {
  const text = unit.trim().toLowerCase();
  if (text === "g" || text === "gram" || text === "grams") return "g";
  if (text === "ml" || text === "millilitre" || text === "millilitres" || text === "milliliter" || text === "milliliters") return "ml";
  if (text === "serving" || text === "servings") return "serving";
  if (text === "piece" || text === "pieces") return "piece";
  return null;
}

/** Same sentences as the server. */
export function amountError(amount: number, unit: string): string | null {
  const kind = normalizeUnit(unit);
  if (!kind) return "Choose grams, ml, a serving or a piece.";
  const max = kind === "serving" || kind === "piece" ? 50 : 10000;
  if (amount <= 0 || amount > max) {
    if (kind === "ml") return "Enter an amount above 0 and at most 10,000 ml.";
    if (kind === "serving") return "Enter an amount above 0 and at most 50 servings.";
    if (kind === "piece") return "Enter an amount above 0 and at most 50 pieces.";
    return "Enter an amount above 0 and at most 10,000 g.";
  }
  return null;
}

export function amountLabel(amount: number, unit: string): string {
  const kind = normalizeUnit(unit) ?? "g";
  const text = String(round2(amount));
  if (kind === "g" || kind === "ml") return `${text} ${kind}`;
  const word = amount === 1 || amount < 1 ? kind : (PLURAL[kind] ?? `${kind}s`);
  return `${text} ${word}`;
}

export function unitsForFood(food: CatalogFood): UnitChoice[] {
  if (food.nutrientBasis === "per_serving") {
    return [{ unit: "serving", label: food.servingLabel || "serving", gramsEach: null }];
  }
  const units: UnitChoice[] = [{ unit: "g", label: "g", gramsEach: 1 }];
  if (food.basis === "ml") units.push({ unit: "ml", label: "ml", gramsEach: 1 });
  if (food.servingQuantity != null && food.servingQuantity > 0) {
    units.push({ unit: "serving", label: food.servingLabel || "serving", gramsEach: food.servingQuantity });
  }
  if (food.pieceQuantity != null && food.pieceQuantity > 0) {
    units.push({ unit: "piece", label: food.pieceLabel || "piece", gramsEach: food.pieceQuantity });
  }
  return units;
}

/** Edit offers grams (or ml) and the unit the entry was logged in. Sizes come from the entry. */
export function unitsForEntry(entry: StoredEntry): UnitChoice[] {
  const kind = normalizeUnit(entry.unit);
  if (entry.grams == null || entry.grams <= 0) {
    const unit = kind === "piece" ? "piece" : "serving";
    return [{ unit, label: unit, gramsEach: null }];
  }
  const each = entry.amount > 0 ? entry.grams / entry.amount : null;
  if (kind === "piece" || kind === "serving") {
    return [
      { unit: "g", label: "g", gramsEach: 1 },
      { unit: kind, label: kind, gramsEach: each },
    ];
  }
  if (kind === "ml") {
    return [
      { unit: "g", label: "g", gramsEach: 1 },
      { unit: "ml", label: "ml", gramsEach: 1 },
    ];
  }
  return [{ unit: "g", label: "g", gramsEach: 1 }];
}

export function macrosForFood(food: CatalogFood, amount: number, unit: string): MacroPreview {
  const empty: MacroPreview = { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: null };
  if (amount <= 0) return empty;
  const choice = unitsForFood(food).find((item) => item.unit === normalizeUnit(unit));
  if (!choice) return empty;
  if (food.nutrientBasis === "per_serving" || choice.gramsEach == null) {
    return {
      kcal: round2(food.kcalPer100 * amount),
      protein: round2(food.proteinPer100 * amount),
      fat: round2(food.fatPer100 * amount),
      carbs: round2(food.carbsPer100 * amount),
      grams: null,
    };
  }
  const grams = round2(amount * choice.gramsEach);
  const factor = grams / 100;
  return {
    kcal: round2(food.kcalPer100 * factor),
    protein: round2(food.proteinPer100 * factor),
    fat: round2(food.fatPer100 * factor),
    carbs: round2(food.carbsPer100 * factor),
    grams,
  };
}

/** Scale an existing entry the way the server does. Does not read a current food. */
export function scaleStored(entry: StoredEntry, amount: number, unit: string): MacroPreview {
  const empty: MacroPreview = { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: entry.grams };
  const kind = normalizeUnit(unit);
  const old = normalizeUnit(entry.unit);
  if (!kind || amount <= 0 || entry.amount === 0) return empty;
  let factor: number;
  let grams = entry.grams;
  if (entry.grams != null && entry.grams > 0 && (kind === "g" || kind === "ml") && kind !== old) {
    grams = round2(amount);
    factor = grams / entry.grams;
  } else {
    factor = amount / entry.amount;
    grams = entry.grams == null ? null : round2(entry.grams * factor);
  }
  return {
    kcal: round2(entry.kcal * factor),
    protein: round2(entry.protein * factor),
    fat: round2(entry.fat * factor),
    carbs: round2(entry.carbs * factor),
    grams,
  };
}

/** One decimal when the macro has a fraction. Whole numbers stay bare, including 0. */
export function macroFigure(value: number): string {
  const rounded = roundHalfAwayFromZero(value, 1);
  if (rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return formatDecimal(rounded, 1);
}

export function per100Line(food: CatalogFood): string {
  const basis = food.nutrientBasis === "per_serving"
    ? `per ${food.servingLabel || "serving"}`
    : `per 100 ${food.basis === "ml" ? "ml" : "g"}`;
  return `${basis} · ${Math.round(food.kcalPer100)} kcal · P${macroFigure(food.proteinPer100)} F${macroFigure(food.fatPer100)} C${macroFigure(food.carbsPer100)}`;
}

export function defaultAmount(food: CatalogFood): { amount: string; unit: UnitChoice["unit"] } {
  if (food.nutrientBasis === "per_serving") return { amount: "1", unit: "serving" };
  return { amount: "100", unit: "g" };
}
