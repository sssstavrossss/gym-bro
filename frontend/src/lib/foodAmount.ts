import { formatDecimal, roundHalfAwayFromZero } from "./format";

/** A food row from `GET /api/foods/search` or `GET /api/foods/{id}`. */
export interface CatalogFood {
  id: string;
  source: string;
  name: string;
  nameEn: string | null;
  basis: string | null;
  confirmedBasis?: "g" | "ml" | null;
  nutrientBasis: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  servingQuantity: number | null;
  servingLabel: string | null;
  pieceQuantity: number | null;
  pieceLabel: string | null;
  brand?: string | null;
  barcode?: string | null;
  /** Servings this person added. Empty or absent when they have none. */
  servings?: OwnServing[];
}

/** A gram size only this person can see, such as "1 slice = 35 g". */
export interface OwnServing {
  id: string;
  name: string;
  grams: number;
}

export interface UnitChoice {
  unit: string;
  /** Chip text. The value sent to the API is `unit`, not this label. */
  label: string;
  /** Grams in one of this unit. Null for a per-serving food. */
  gramsEach: number | null;
  /** A serving the person added. The label already includes the gram equivalent. */
  named?: boolean;
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

export const servingNameMax = 16;

/** A food stored per 100 g. Liquids and per-serving foods have no gram basis. */
export function hasGramBasis(food: CatalogFood): boolean {
  return food.nutrientBasis === "per_100" && food.basis === "g";
}

/** The name to store, or null when it is empty, too long, or already g, ml, serving, or piece. */
export function servingName(unit: string): string | null {
  const text = unit.trim().replace(/\s+/g, " ");
  if (text.length < 1 || text.length > servingNameMax) return null;
  if (normalizeUnit(text)) return null;
  return text;
}

export function gramText(value: number): string {
  const rounded = round2(value);
  if (rounded === 0) return "0";
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Chip text for a serving the person added. */
export function servingChipLabel(name: string, grams: number): string {
  return `1 ${name} = ${gramText(grams)} g`;
}

/** Same sentences as the server, before a serving is saved. */
export function servingDefinitionError(name: string, grams: number): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Give the serving a name.";
  if (trimmed.length > servingNameMax) return "Use a shorter serving name.";
  if (normalizeUnit(trimmed)) return "That name is already a unit. Try slice or sandwich.";
  if (!(grams > 0) || grams > 10000) return "Enter a weight above 0 and at most 10,000 g.";
  return null;
}

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
  const named = kind ? null : servingName(unit);
  if (!kind && !named) return "Choose grams, ml, a serving or a piece.";
  const max = !kind || kind === "serving" || kind === "piece" ? 50 : 10000;
  if (amount <= 0 || amount > max) {
    if (kind === "ml") return "Enter an amount above 0 and at most 10,000 ml.";
    if (kind === "piece") return "Enter an amount above 0 and at most 50 pieces.";
    if (kind === "g") return "Enter an amount above 0 and at most 10,000 g.";
    return "Enter an amount above 0 and at most 50 servings.";
  }
  return null;
}

function countWord(name: string, amount: number): string {
  if (amount === 1 || amount < 1) return name;
  const known = PLURAL[name];
  if (known) return known;
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

export function amountLabel(amount: number, unit: string): string {
  const kind = normalizeUnit(unit);
  const text = String(round2(amount));
  if (kind === "g" || kind === "ml") return `${text} ${kind}`;
  const name = kind ?? servingName(unit) ?? unit;
  return `${text} ${countWord(name, amount)}`;
}

export function unitsForFood(food: CatalogFood): UnitChoice[] {
  if (food.nutrientBasis === "unconfirmed") {
    return [
      { unit: "g", label: "g", gramsEach: 1 },
      { unit: "ml", label: "ml", gramsEach: null },
    ];
  }
  if (food.nutrientBasis === "per_serving") {
    return [{ unit: "serving", label: food.servingLabel || "serving", gramsEach: null }];
  }
  if (food.basis === "ml") {
    const units: UnitChoice[] = [{ unit: "ml", label: "ml", gramsEach: null }];
    if (food.servingQuantity != null && food.servingQuantity > 0) {
      units.push({ unit: "serving", label: food.servingLabel || "serving", gramsEach: food.servingQuantity });
    }
    if (food.pieceQuantity != null && food.pieceQuantity > 0) {
      units.push({ unit: "piece", label: food.pieceLabel || "piece", gramsEach: food.pieceQuantity });
    }
    return units;
  }
  const units: UnitChoice[] = [{ unit: "g", label: "g", gramsEach: 1 }];
  if (food.servingQuantity != null && food.servingQuantity > 0) {
    units.push({ unit: "serving", label: food.servingLabel || "serving", gramsEach: food.servingQuantity });
  }
  if (food.pieceQuantity != null && food.pieceQuantity > 0) {
    units.push({ unit: "piece", label: food.pieceLabel || "piece", gramsEach: food.pieceQuantity });
  }
  units.push(...ownServingUnits(food));
  return units;
}

function ownServingUnits(food: CatalogFood): UnitChoice[] {
  if (!hasGramBasis(food)) return [];
  return (food.servings ?? [])
    .filter((row) => servingName(row.name) && row.grams > 0)
    .map((row) => ({
      unit: row.name,
      label: servingChipLabel(row.name, row.grams),
      gramsEach: row.grams,
      named: true,
    }));
}

function choiceFor(food: CatalogFood, unit: string): UnitChoice | undefined {
  const standard = normalizeUnit(unit);
  if (standard) return unitsForFood(food).find((item) => item.unit === standard);
  const name = servingName(unit);
  if (!name) return undefined;
  return unitsForFood(food).find((item) => item.named && item.unit.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
}

/** Edit offers grams (or ml) and the unit the entry was logged in. Sizes come from the entry. */
export function unitsForEntry(entry: StoredEntry): UnitChoice[] {
  const kind = normalizeUnit(entry.unit);
  if (entry.grams == null || entry.grams <= 0) {
    const unit = kind === "piece" ? "piece" : "serving";
    return [{ unit, label: unit, gramsEach: null }];
  }
  const each = entry.amount > 0 ? round2(entry.grams / entry.amount) : null;
  const named = kind ? null : servingName(entry.unit);
  if (kind === "piece" || kind === "serving") {
    return [
      { unit: "g", label: "g", gramsEach: 1 },
      { unit: kind, label: kind, gramsEach: each },
    ];
  }
  if (named) {
    return [
      { unit: "g", label: "g", gramsEach: 1 },
      { unit: named, label: servingChipLabel(named, each ?? 0), gramsEach: each, named: true },
    ];
  }
  if (kind === "ml") {
    return [{ unit: "ml", label: "ml", gramsEach: null }];
  }
  return [{ unit: "g", label: "g", gramsEach: 1 }];
}

export function macrosForFood(food: CatalogFood, amount: number, unit: string): MacroPreview {
  const empty: MacroPreview = { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: null };
  if (amount <= 0) return empty;
  const choice = choiceFor(food, unit);
  if (!choice) return empty;
  const kind = normalizeUnit(unit);
  if (kind === "ml" || food.basis === "ml") {
    const factor = amount / 100;
    return {
      kcal: round2(food.kcalPer100 * factor),
      protein: round2(food.proteinPer100 * factor),
      fat: round2(food.fatPer100 * factor),
      carbs: round2(food.carbsPer100 * factor),
      grams: null,
    };
  }
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
  const kind = normalizeUnit(unit) ?? servingName(unit);
  const old = normalizeUnit(entry.unit) ?? servingName(entry.unit);
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
  const basis = food.nutrientBasis === "unconfirmed"
    ? "as reported"
    : food.nutrientBasis === "per_serving"
    ? `per ${food.servingLabel || "serving"}`
    : `per 100 ${food.basis === "ml" ? "ml" : "g"}`;
  return `${basis} · ${Math.round(food.kcalPer100)} kcal · P${macroFigure(food.proteinPer100)} F${macroFigure(food.fatPer100)} C${macroFigure(food.carbsPer100)}`;
}

export function defaultAmount(food: CatalogFood): { amount: string; unit: UnitChoice["unit"] } {
  if (food.nutrientBasis === "per_serving") return { amount: "1", unit: "serving" };
  if (food.basis === "ml") return { amount: "100", unit: "ml" };
  if (food.nutrientBasis === "unconfirmed") return { amount: "100", unit: "g" };
  return { amount: "100", unit: "g" };
}
