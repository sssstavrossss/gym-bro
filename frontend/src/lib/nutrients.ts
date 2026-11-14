/** Per-100 g or per-entry nutrient numbers. A missing key is unknown, never zero. */
export type NutrientMap = Record<string, number | null | undefined>;

export interface NutrientRow {
  key: string;
  label: string;
  unit: string;
}

export interface NutrientPanelDef {
  id: string;
  title: string;
  keys: string[];
  grid?: boolean;
}

const ROWS: Record<string, NutrientRow> = {
  saturatedFat: { key: "saturatedFat", label: "Saturated", unit: "g" },
  monoFat: { key: "monoFat", label: "Mono", unit: "g" },
  polyFat: { key: "polyFat", label: "Poly", unit: "g" },
  transFat: { key: "transFat", label: "Trans", unit: "g" },
  omega3: { key: "omega3", label: "Omega-3", unit: "g" },
  omega6: { key: "omega6", label: "Omega-6", unit: "g" },
  cholesterol: { key: "cholesterol", label: "Cholesterol", unit: "mg" },
  sugars: { key: "sugars", label: "Sugars", unit: "g" },
  addedSugars: { key: "addedSugars", label: "Added sugars", unit: "g" },
  fiber: { key: "fiber", label: "Fibre", unit: "g" },
  sodium: { key: "sodium", label: "Sodium", unit: "mg" },
  vitaminA: { key: "vitaminA", label: "Vitamin A", unit: "µg" },
  vitaminD: { key: "vitaminD", label: "Vitamin D", unit: "µg" },
  vitaminE: { key: "vitaminE", label: "Vitamin E", unit: "mg" },
  vitaminC: { key: "vitaminC", label: "Vitamin C", unit: "mg" },
  thiamin: { key: "thiamin", label: "Thiamin", unit: "mg" },
  riboflavin: { key: "riboflavin", label: "Riboflavin", unit: "mg" },
  niacin: { key: "niacin", label: "Niacin", unit: "mg" },
  vitaminB6: { key: "vitaminB6", label: "Vitamin B6", unit: "mg" },
  folate: { key: "folate", label: "Folate", unit: "µg" },
  vitaminB12: { key: "vitaminB12", label: "Vitamin B12", unit: "µg" },
  calcium: { key: "calcium", label: "Calcium", unit: "mg" },
  iron: { key: "iron", label: "Iron", unit: "mg" },
  zinc: { key: "zinc", label: "Zinc", unit: "mg" },
  magnesium: { key: "magnesium", label: "Magnesium", unit: "mg" },
  potassium: { key: "potassium", label: "Potassium", unit: "mg" },
  phosphorus: { key: "phosphorus", label: "Phosphorus", unit: "mg" },
  selenium: { key: "selenium", label: "Selenium", unit: "µg" },
  iodine: { key: "iodine", label: "Iodine", unit: "µg" },
};

export const NUTRIENT_PANELS: NutrientPanelDef[] = [
  { id: "fats", title: "Fats", grid: true, keys: ["saturatedFat", "monoFat", "polyFat", "transFat", "omega3", "omega6", "cholesterol"] },
  { id: "carbs", title: "Carbs & sodium", keys: ["sugars", "addedSugars", "fiber", "sodium"] },
  { id: "vitamins", title: "Vitamins", keys: ["vitaminA", "vitaminD", "vitaminE", "vitaminC"] },
  { id: "b", title: "B vitamins", keys: ["thiamin", "riboflavin", "niacin", "vitaminB6", "folate", "vitaminB12"] },
  { id: "minerals", title: "Minerals", keys: ["calcium", "iron", "zinc", "magnesium"] },
  { id: "more", title: "More minerals", keys: ["potassium", "phosphorus", "selenium", "iodine"] },
];

export function nutrientRow(key: string): NutrientRow {
  return ROWS[key];
}

/** Source sodium in mg, otherwise salt grams ÷ 2.5. Missing both stays null. */
export function sodiumMg(sodium: number | null | undefined, saltGrams: number | null | undefined): number | null {
  if (sodium != null && Number.isFinite(sodium)) return sodium;
  if (saltGrams != null && Number.isFinite(saltGrams)) return (saltGrams / 2.5) * 1000;
  return null;
}

export function completeSum(values: readonly (number | null | undefined)[]): number | null {
  if (values.length === 0) return null;
  if (values.some((value) => value == null || !Number.isFinite(value))) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export interface NutrientSource {
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  nutrients?: NutrientMap | null;
}

function rawOf(source: NutrientSource, key: string): number | null {
  if (key === "sodium") return sodiumMg(source.nutrients?.sodium, source.salt);
  if (key === "saturatedFat") return source.saturatedFat ?? null;
  if (key === "sugars") return source.sugars ?? null;
  if (key === "fiber") return source.fiber ?? null;
  const value = source.nutrients?.[key];
  return value == null ? null : value;
}

export function valuesOf(source: NutrientSource): NutrientMap {
  const out: NutrientMap = {};
  for (const key of Object.keys(ROWS)) out[key] = rawOf(source, key);
  return out;
}

export function dayNutrients(entries: readonly NutrientSource[]): NutrientMap {
  const out: NutrientMap = {};
  for (const key of Object.keys(ROWS)) {
    out[key] = completeSum(entries.map((entry) => rawOf(entry, key)));
  }
  return out;
}

export function panelHasData(entries: readonly NutrientSource[], keys: readonly string[]): boolean {
  return keys.some((key) => entries.some((entry) => rawOf(entry, key) != null));
}

/** At the largest text size, a panel with more than four nutrients becomes groups of four. */
export function panelsForSize(entries: readonly NutrientSource[], large: boolean): NutrientPanelDef[] {
  const shown: NutrientPanelDef[] = [];
  for (const panel of NUTRIENT_PANELS) {
    if (!panelHasData(entries, panel.keys)) continue;
    if (large && panel.keys.length > 4) {
      for (let index = 0; index < panel.keys.length; index += 4) {
        const keys = panel.keys.slice(index, index + 4);
        shown.push({ id: `${panel.id}-${index}`, title: panel.title, keys, grid: false });
      }
    } else {
      shown.push(panel);
    }
  }
  return shown;
}

export function formatNutrient(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const rounded = abs >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

export function osloYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", year: "numeric" }).format(now));
}

type Sex = "male" | "female";

function band(age: number): "11" | "15" | "18" | "25" | "51" | "71" | null {
  if (age < 11) return null;
  if (age <= 14) return "11";
  if (age <= 17) return "15";
  if (age <= 24) return "18";
  if (age <= 50) return "25";
  if (age <= 70) return "51";
  return "71";
}

/**
 * NNR 2023 / Helsedirektoratet reference for adults, in the nutrient's display unit.
 * Adequate intakes use the same number. Unknown age or sex returns null.
 * Thiamin and niacin are per MJ and are not in this table.
 */
export function referenceAmount(key: string, sex: string, age: number): number | null {
  if (sex !== "male" && sex !== "female") return null;
  const group = band(age);
  if (!group || group === "11" || group === "15") {
    if (key === "iron" && sex === "male" && (group === "11" || group === "15")) return 11;
    return null;
  }
  const male = sex === "male";
  switch (key) {
    case "vitaminA":
      if (group === "71") return male ? 750 : 650;
      return male ? 800 : 700;
    case "vitaminD":
      return age >= 75 ? 20 : 10;
    case "vitaminE":
      if (!male && (group === "51" || group === "71")) return 9;
      return male ? 11 : 10;
    case "vitaminC":
      return male ? 110 : 95;
    case "riboflavin":
      return 1.6;
    case "vitaminB6":
      if (male && group === "71") return 1.7;
      return male ? 1.8 : 1.6;
    case "folate":
      return 330;
    case "vitaminB12":
      return 4;
    case "calcium":
      return group === "18" ? 1000 : 950;
    case "iron":
      if (male) return 9;
      if (group === "18" || group === "25") return 15;
      if (group === "51") return 8;
      return 7;
    case "zinc":
      if (group === "71") return male ? 12.1 : 9.3;
      if (group === "51") return male ? 12.4 : 9.5;
      return male ? 12.7 : 9.7;
    case "magnesium":
      return male ? 350 : 300;
    case "potassium":
      return 3500;
    case "phosphorus":
      return group === "18" ? 550 : 520;
    case "selenium":
      if (male && group === "71") return 85;
      return male ? 90 : 75;
    case "iodine":
      return 150;
    case "sodium":
      return 1500;
    default:
      return null;
  }
}

/** Integer percent of the reference. Thiamin and niacin need a kcal target. */
export function nutrientPercent(key: string, value: number | null | undefined, sex: string, age: number, kcalTarget: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  let ref = referenceAmount(key, sex, age);
  if (key === "thiamin" || key === "niacin") {
    if (kcalTarget == null || !Number.isFinite(kcalTarget) || kcalTarget <= 0) return null;
    const mj = kcalTarget / 239;
    ref = key === "thiamin" ? 0.1 * mj : 1.6 * mj;
  }
  if (ref == null || ref <= 0) return null;
  return Math.round((value / ref) * 100);
}

export function scaleMap(source: NutrientMap, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value == null ? null : Math.round(value * factor * 100) / 100;
  }
  return out;
}
