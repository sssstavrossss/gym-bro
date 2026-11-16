import { fiberMinimum } from "./progressCard";
import { formatNutrient, nutrientName, nutrientPercent, nutrientRow, referenceFor, sourceValue, upperLimit, type NutrientMap, type NutrientSource } from "./nutrients";

/** Who the references are for. kcalTarget sets thiamin, niacin, and the saturated fat limit. */
export interface NutrientPerson {
  sex: string;
  age: number;
  kcalTarget: number | null;
}

/* ---------------------------------------------------------------- Fats */

export type FatLimitsSetting = "normal" | "lower";

/** A saved setting, or normal when it is missing or unknown. */
export function fatLimitsOf(value: unknown): FatLimitsSetting {
  return value === "lower" ? "lower" : "normal";
}

export const FAT_PART_KEYS = ["saturatedFat", "monoFat", "polyFat", "transFat"] as const;
export type FatPartKey = (typeof FAT_PART_KEYS)[number] | "rest";

export interface FatPart {
  key: FatPartKey;
  label: string;
  grams: number;
}

/**
 * The day's fat in its known kinds, plus what no label broke down: total fat minus the known
 * kinds, never below 0. A label that lists only saturated fat leaves the rest of its fat there.
 */
export function fatBreakdown(values: NutrientMap): { total: number; parts: FatPart[] } {
  const total = positive(values.fat);
  const parts: FatPart[] = FAT_PART_KEYS.map((key) => ({ key, label: nutrientRow(key).label, grams: positive(values[key]) }));
  const known = parts.reduce((sum, part) => sum + part.grams, 0);
  parts.push({ key: "rest", label: "Not broken down", grams: Math.max(0, total - known) });
  return { total, parts };
}

export interface FatLimits {
  setting: FatLimitsSetting;
  /** Saturated fat as a share of the kcal target: 10 (NNR 2023) or 7 (lower). */
  saturatedPercent: number;
  /** That share in grams, one decimal. Null without a kcal target. */
  saturatedGrams: number | null;
  /** A daily cholesterol cap in mg. Lower limits only: NNR 2023 sets none. */
  cholesterolMg: number | null;
}

export function fatLimits(setting: FatLimitsSetting, kcalTarget: number | null | undefined): FatLimits {
  const lower = setting === "lower";
  const saturatedPercent = lower ? 7 : 10;
  const saturatedGrams = kcalTarget != null && Number.isFinite(kcalTarget) && kcalTarget > 0
    ? oneDecimal((kcalTarget * saturatedPercent) / 100 / 9)
    : null;
  return { setting: lower ? "lower" : "normal", saturatedPercent, saturatedGrams, cholesterolMg: lower ? 200 : null };
}

export interface LimitStatus {
  /** Eaten ÷ limit, for the bar. */
  fraction: number;
  /** Amount above the limit, or null at or under it. */
  over: number | null;
}

export function limitStatus(value: number, limit: number): LimitStatus {
  if (!(limit > 0)) return { fraction: 0, over: null };
  return { fraction: value / limit, over: value > limit ? value - limit : null };
}

/** How far toward a minimum a value is, such as fibre's. */
export interface GoalStatus {
  /** Eaten ÷ goal, for the bar. */
  fraction: number;
  /** Amount still to reach the goal, or null once it is reached. */
  toGo: number | null;
}

export function goalStatus(value: number, goal: number): GoalStatus {
  if (!(goal > 0)) return { fraction: 0, toGo: null };
  return { fraction: value / goal, toGo: value < goal ? goal - value : null };
}

/* ---------------------------------------------------------------- Carbs and sodium */

export type CarbPartKey = "sugars" | "starch" | "rest";

export interface CarbPart {
  key: CarbPartKey;
  label: string;
  grams: number;
}

/**
 * The day's carbs in sugars and starch, plus what no label broke down: the carbs total minus
 * those two, never below 0. Added sugars are part of sugars, so they are not a part of their own.
 */
export function carbBreakdown(total: number, values: NutrientMap): { total: number; parts: CarbPart[]; addedSugars: number } {
  const carbs = positive(total);
  const sugars = positive(values.sugars);
  const starch = positive(values.starch);
  return {
    total: carbs,
    parts: [
      { key: "sugars", label: "Sugars", grams: sugars },
      { key: "starch", label: "Starch", grams: starch },
      { key: "rest", label: "Not broken down", grams: Math.max(0, carbs - sugars - starch) },
    ],
    addedSugars: positive(values.addedSugars),
  };
}

/** NNR 2023 limits sodium to 2.3 g a day. 1.5 g is the adequate intake, not a limit. */
export const SODIUM_LIMIT_MG = 2300;

export interface CarbLimits {
  /** Fibre to reach, the Progress card's minimum: 25 g for women, 35 g for men. Null without a sex. */
  fibreGrams: number | null;
  /** Added sugars below 10% of the kcal target (NNR 2023), at 4 kcal a gram. Null without a target. */
  addedSugarsGrams: number | null;
  sodiumMg: number;
}

export function carbLimits(person: Pick<NutrientPerson, "sex" | "kcalTarget">): CarbLimits {
  const kcal = person.kcalTarget != null && Number.isFinite(person.kcalTarget) && person.kcalTarget > 0 ? person.kcalTarget : null;
  return {
    fibreGrams: fiberMinimum(person.sex),
    addedSugarsGrams: kcal == null ? null : oneDecimal((kcal * 0.1) / 4),
    sodiumMg: SODIUM_LIMIT_MG,
  };
}

/* ---------------------------------------------------------------- Rings */

export interface NutrientRing {
  key: string;
  label: string;
  name: string;
  /** The day's amount with its unit. */
  amount: string;
  /** Percent of the reference. Null when there is no reference for this person. */
  percent: number | null;
  /** Outer ring, 0 to 1. */
  fill: number;
  /** At or above the reference. */
  hit: boolean;
  /** Above the upper intake limit. */
  overLimit: boolean;
  /** Inner ring for the week's daily average, 0 to 1. Null when there is no average. */
  weekFill: number | null;
}

export function nutrientRing(key: string, value: number, weekValue: number | null | undefined, person: NutrientPerson): NutrientRing {
  const row = nutrientRow(key);
  const percent = nutrientPercent(key, value, person.sex, person.age, person.kcalTarget);
  const weekPercent = weekValue == null ? null : nutrientPercent(key, weekValue, person.sex, person.age, person.kcalTarget);
  const limit = upperLimit(key);
  return {
    key,
    label: row.label,
    name: nutrientName(key),
    amount: formatNutrient(value, row.unit, row.fine),
    percent,
    fill: percent == null ? 0 : clamp01(percent / 100),
    hit: percent != null && percent >= 100,
    overLimit: limit != null && value > limit,
    weekFill: weekPercent == null ? null : clamp01(weekPercent / 100),
  };
}

/* ---------------------------------------------------------------- Coverage and sources */

/** Entries that know at least one of the keys, out of all entries. */
export function panelCoverage(entries: readonly NutrientSource[], keys: readonly string[]): { known: number; total: number } {
  const known = entries.filter((entry) => keys.some((key) => sourceValue(entry, key) != null)).length;
  return { known, total: entries.length };
}

/** "from 3 of 5 foods" when some entries know nothing of the panel. Empty when all do. */
export function coverageNote(coverage: { known: number; total: number }): string {
  if (coverage.total === 0 || coverage.known === coverage.total) return "";
  return `from ${coverage.known} of ${coverage.total} foods`;
}

export interface DaySourceRow {
  id: string;
  name: string;
  value: number;
  /** Bar width, 0 to 1: share of the reference, or of the largest source without one. */
  fraction: number;
}

export interface DaySources {
  rows: DaySourceRow[];
  /** Names of entries that don't know this nutrient, once each. */
  missing: string[];
}

/** What gave the day its amount of `key`, largest first. Zero amounts are left out. */
export function daySources(entries: readonly (NutrientSource & { id: string; name: string })[], key: string, reference: number | null): DaySources {
  const rows: DaySourceRow[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    const value = sourceValue(entry, key);
    if (value == null) {
      if (!missing.includes(entry.name)) missing.push(entry.name);
    } else if (value > 0) {
      rows.push({ id: entry.id, name: entry.name, value, fraction: 0 });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  const scale = reference != null && reference > 0 ? reference : rows[0]?.value ?? 0;
  for (const row of rows) row.fraction = scale > 0 ? clamp01(row.value / scale) : 0;
  return { rows, missing };
}

/** The reference and upper limit lines on the nutrient sheet. */
export function referenceText(key: string, person: NutrientPerson): string {
  const row = nutrientRow(key);
  const parts: string[] = [];
  const reference = referenceFor(key, person.sex, person.age, person.kcalTarget);
  if (reference != null) parts.push(`reference ${formatNutrient(reference, row.unit, row.fine)}`);
  const limit = upperLimit(key);
  if (limit != null) parts.push(`upper limit ${formatNutrient(limit, row.unit, row.fine)}`);
  return parts.join(" · ");
}

function positive(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : 0;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
