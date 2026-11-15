/** Per-100 g or per-entry nutrient numbers. A missing key is unknown, never zero. */
export type NutrientMap = Record<string, number | null | undefined>;

export interface NutrientRow {
  key: string;
  label: string;
  unit: string;
  /** Two decimals below 1, for a nutrient whose daily amount is about 1 (copper: 0.04 mg, not 0). */
  fine?: boolean;
}

export interface NutrientPanelDef {
  id: string;
  title: string;
  keys: string[];
  grid?: boolean;
  /** Two name/value/% columns even on the food sheet, which otherwise keeps Per 100 g and Amount. */
  halves?: boolean;
  /** Names that sit in from the left edge, such as Saturated under Fat. */
  indent?: string[];
  /** Least important first. Dropped, in this order, when a layout has fewer rows than keys. */
  spare?: string[];
  /** Rows that fit on the food sheet (Per 100 g and Amount in one column). No limit when unset. */
  pairedMax?: number;
  /** Rows at the largest text size: the page count stays what it was, four rows a page. */
  largeMax?: number;
}

const ROWS: Record<string, NutrientRow> = {
  fat: { key: "fat", label: "Fat", unit: "g" },
  saturatedFat: { key: "saturatedFat", label: "Saturated", unit: "g" },
  monoFat: { key: "monoFat", label: "Mono", unit: "g" },
  polyFat: { key: "polyFat", label: "Poly", unit: "g" },
  transFat: { key: "transFat", label: "Trans", unit: "g" },
  omega3: { key: "omega3", label: "Omega-3", unit: "g" },
  epaDha: { key: "epaDha", label: "EPA + DHA", unit: "g" },
  omega6: { key: "omega6", label: "Omega-6", unit: "g" },
  cholesterol: { key: "cholesterol", label: "Cholesterol", unit: "mg" },
  sugars: { key: "sugars", label: "Sugars", unit: "g" },
  addedSugars: { key: "addedSugars", label: "Added sugars", unit: "g" },
  starch: { key: "starch", label: "Starch", unit: "g" },
  fiber: { key: "fiber", label: "Fibre", unit: "g" },
  sodium: { key: "sodium", label: "Sodium", unit: "mg" },
  vitaminA: { key: "vitaminA", label: "Vit A", unit: "µg" },
  vitaminD: { key: "vitaminD", label: "Vit D", unit: "µg" },
  vitaminE: { key: "vitaminE", label: "Vit E", unit: "mg" },
  vitaminC: { key: "vitaminC", label: "Vit C", unit: "mg" },
  thiamin: { key: "thiamin", label: "B1", unit: "mg" },
  riboflavin: { key: "riboflavin", label: "B2", unit: "mg" },
  niacin: { key: "niacin", label: "B3", unit: "mg" },
  vitaminB6: { key: "vitaminB6", label: "B6", unit: "mg" },
  folate: { key: "folate", label: "Folate", unit: "µg" },
  vitaminB12: { key: "vitaminB12", label: "B12", unit: "µg" },
  calcium: { key: "calcium", label: "Calcium", unit: "mg" },
  iron: { key: "iron", label: "Iron", unit: "mg" },
  zinc: { key: "zinc", label: "Zinc", unit: "mg" },
  magnesium: { key: "magnesium", label: "Magnesium", unit: "mg" },
  potassium: { key: "potassium", label: "Potassium", unit: "mg" },
  phosphorus: { key: "phosphorus", label: "Phosphorus", unit: "mg" },
  selenium: { key: "selenium", label: "Selenium", unit: "µg" },
  iodine: { key: "iodine", label: "Iodine", unit: "µg" },
  copper: { key: "copper", label: "Copper", unit: "mg", fine: true },
};

/**
 * Five rows is the most a panel shows at default text (Vitamins: two columns of five), so the
 * fixed Home card height holds. Where a layout has room for fewer rows, the `spare` keys give
 * way, least important first, instead of adding a page.
 */
const FATS = ["fat", "saturatedFat", "monoFat", "polyFat", "transFat", "omega3", "epaDha", "omega6", "cholesterol"];
const VITAMINS = ["vitaminA", "vitaminD", "vitaminE", "vitaminC", "thiamin", "riboflavin", "niacin", "vitaminB6", "folate", "vitaminB12"];
const MINERALS = ["calcium", "iron", "zinc", "magnesium", "copper", "potassium", "phosphorus", "selenium", "iodine"];

export const NUTRIENT_PANELS: NutrientPanelDef[] = [
  { id: "fats", title: "Fats", grid: true, indent: ["saturatedFat", "epaDha"], keys: FATS, spare: ["omega6"], pairedMax: 8, largeMax: 8 },
  { id: "carbs", title: "Carbs & sodium", keys: ["sugars", "addedSugars", "starch", "fiber", "sodium"], spare: ["starch"], largeMax: 4 },
  { id: "vitamins", title: "Vitamins", grid: true, halves: true, keys: VITAMINS },
  { id: "minerals", title: "Minerals", grid: true, halves: true, keys: MINERALS, spare: ["copper"], largeMax: 8 },
];

/** The panel's keys cut to `max` rows by dropping its spare keys, least important first. */
export function fitKeys(panel: NutrientPanelDef, max: number | undefined): string[] {
  if (max == null || panel.keys.length <= max) return panel.keys;
  const drop = new Set((panel.spare ?? []).slice(0, panel.keys.length - max));
  return panel.keys.filter((key) => !drop.has(key));
}

export function nutrientRow(key: string): NutrientRow {
  return ROWS[key];
}

/** Source sodium in mg, otherwise salt grams ÷ 2.5. Missing both stays null. */
export function sodiumMg(sodium: number | null | undefined, saltGrams: number | null | undefined): number | null {
  if (sodium != null && Number.isFinite(sodium)) return sodium;
  if (saltGrams != null && Number.isFinite(saltGrams)) return (saltGrams / 2.5) * 1000;
  return null;
}

/** Sum of the known values; an unknown one counts as 0. Null only when none is known. */
export function knownSum(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0);
}

export interface NutrientSource {
  fat?: number | null;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  nutrients?: NutrientMap | null;
}

function rawOf(source: NutrientSource, key: string): number | null {
  if (key === "fat") return source.fat ?? null;
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
    // A day total is always a number: what is known, with unknown counted as 0.
    out[key] = knownSum(entries.map((entry) => rawOf(entry, key))) ?? 0;
  }
  return out;
}

export function panelHasData(entries: readonly NutrientSource[], keys: readonly string[]): boolean {
  return keys.some((key) => entries.some((entry) => rawOf(entry, key) != null));
}

/**
 * Default text keeps Vitamins and Minerals as one two-column panel each.
 * Largest text drops the two-column merge and shows single-column groups of
 * four, so the fixed card height does not have to grow. `paired` is the food
 * sheet, which shows per 100 g beside the amount in one column. Neither adds a
 * page: a layout with fewer rows drops the panel's spare keys instead.
 */
export function panelsForSize(entries: readonly NutrientSource[], large: boolean, paired = false): NutrientPanelDef[] {
  const shown: NutrientPanelDef[] = [];
  for (const panel of NUTRIENT_PANELS) {
    if (!panelHasData(entries, panel.keys)) continue;
    if (!large) {
      shown.push({ ...panel, keys: paired ? fitKeys(panel, panel.pairedMax) : panel.keys });
      continue;
    }
    const keys = fitKeys(panel, panel.largeMax);
    if (keys.length > 4) {
      for (let index = 0; index < keys.length; index += 4) {
        shown.push({ id: `${panel.id}-${index / 4}`, title: panel.title, keys: keys.slice(index, index + 4), indent: panel.indent, grid: false });
      }
    } else {
      shown.push({ ...panel, keys, grid: false });
    }
  }
  return shown;
}

export function formatNutrient(value: number | null | undefined, unit: string, fine = false): string {
  const parts = nutrientParts(value, unit, fine);
  if (!parts.unit) return parts.whole;
  return `${parts.whole}${parts.frac} ${parts.unit}`;
}

/** Number split so the ones place, the decimal, and the unit each have a fixed slot. */
export function nutrientParts(value: number | null | undefined, unit: string, fine = false): { whole: string; frac: string; unit: string } {
  if (value == null || !Number.isFinite(value)) return { whole: "—", frac: "", unit: "" };
  if (fine && Math.abs(value) < 1) {
    const small = Math.round(value * 100) / 100;
    if (small === 0) return { whole: "0", frac: "", unit };
    const [whole, dec] = Math.abs(small).toFixed(2).replace(/0$/, "").split(".");
    return { whole: `${small < 0 ? "-" : ""}${whole}`, frac: `.${dec}`, unit };
  }
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  if (Number.isInteger(abs)) return { whole: `${sign}${abs}`, frac: "", unit };
  const [whole, dec] = abs.toFixed(1).split(".");
  return { whole: `${sign}${whole}`, frac: `.${dec}`, unit };
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
      // NNR 2023: "The RIs were set to 700 RE/day (females) and 800 RE/day (males)."
      // https://pub.norden.org/nord2023-003/vitamin-a-.html
      // Helsedirektoratet tabell 8, column "Vitamin A RE": 700/800 (women/men 18–70), 650/750 above 70.
      // The importer stores Matvaretabellen "Vit A RE". Shown as µg.
      if (group === "71") return male ? 750 : 650;
      return male ? 800 : 700;
    case "vitaminD":
      return age >= 75 ? 20 : 10;
    case "vitaminE":
      // NNR 2023 adequate intake, mg alpha-TE. Shown as mg.
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
    case "copper":
      // NNR 2023: RI 900 µg/day for women and men (adopted from IOM 2001). Shown as mg.
      // https://pub.norden.org/nord2023-003/copper.html
      return 0.9;
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
