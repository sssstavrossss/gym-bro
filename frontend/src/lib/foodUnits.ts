import { amountError, amountLabel, gramText, normalizeUnit, parseAmount, round2, servingChipLabel, servingDefinitionError, type UnitChoice } from "./foodAmount";

/**
 * How food amounts are shown and typed: `g` (grams and millilitres) or `oz` (ounces and fluid ounces).
 * Entries, recipes and servings stay in grams and millilitres on the server, and protein, fat, carbs
 * and nutrients stay in grams everywhere. Only the amount of food changes. Servings and pieces are
 * counts and never change.
 */
export type FoodUnit = "g" | "oz";

export const G_PER_OZ = 28.349523125;
export const ML_PER_FL_OZ = 29.5735295625;

/** Entries are capped at 10,000 g or ml; in ounces that is 352 oz or 338 fl oz. */
const METRIC_MAX = 10000;

export function foodUnitOf(value: unknown): FoodUnit {
  return value === "oz" ? "oz" : "g";
}

/** Grams or millilitres in one shown unit, or null when the amount is shown as stored (metric, or a count). */
function perShown(unit: string, setting: FoodUnit): number | null {
  if (setting !== "oz") return null;
  const kind = normalizeUnit(unit);
  if (kind === "g") return G_PER_OZ;
  if (kind === "ml") return ML_PER_FL_OZ;
  return null;
}

/** True when this unit is shown in ounces: g or ml with Food set to oz. */
export function isConverted(unit: string, setting: FoodUnit): boolean {
  return perShown(unit, setting) != null;
}

/** The word after a g or ml amount: "oz", "fl oz", or the metric unit itself. */
export function shownWeightWord(unit: string, setting: FoodUnit): string {
  const kind = normalizeUnit(unit) === "ml" ? "ml" : "g";
  if (setting !== "oz") return kind;
  return kind === "ml" ? "fl oz" : "oz";
}

/** A stored amount in the shown unit: 113.4 g is 4 oz. Ounces keep one decimal; counts and metric are unchanged. */
export function toShown(amount: number, unit: string, setting: FoodUnit): number {
  const per = perShown(unit, setting);
  return per == null ? amount : Math.round((amount / per) * 10) / 10;
}

/** A shown amount back in grams or ml, with the two decimals the server keeps: 4 oz is 113.4 g. */
export function fromShown(shown: number, unit: string, setting: FoodUnit): number {
  const per = perShown(unit, setting);
  return per == null ? shown : round2(shown * per);
}

/** Text for an amount field from a stored amount ("150" g becomes "5.3" oz). Empty stays empty. */
export function shownText(stored: string, unit: string, setting: FoodUnit): string {
  if (!isConverted(unit, setting) || stored.trim() === "") return stored;
  const value = Number(stored);
  return Number.isFinite(value) ? String(toShown(value, unit, setting)) : stored;
}

/** A stored amount with its unit: "113.4 g", "4 oz", "8 fl oz", "2 slices". */
export function foodAmountLabel(amount: number, unit: string, setting: FoodUnit): string {
  if (!isConverted(unit, setting)) return amountLabel(amount, unit);
  return `${toShown(amount, unit, setting)} ${shownWeightWord(unit, setting)}`;
}

/** An amount already in the shown unit, for a chip: "4 oz", "150 g", "2 portions". */
export function shownAmountLabel(shown: number, unit: string, setting: FoodUnit): string {
  if (!isConverted(unit, setting)) return amountLabel(shown, unit);
  return `${shown} ${shownWeightWord(unit, setting)}`;
}

/** The size of one serving or piece: "150 g" or "5.3 oz" (ml and fl oz for a drink). */
export function sizeLabel(gramsOrMl: number, base: "g" | "ml", setting: FoodUnit): string {
  if (setting !== "oz") return `${gramText(gramsOrMl)} ${base}`;
  return foodAmountLabel(gramsOrMl, base, setting);
}

/** Quick amount chips, in the shown unit. */
export function quickAmountsFor(unit: string, setting: FoodUnit): number[] {
  const kind = normalizeUnit(unit);
  if (kind === "g") return setting === "oz" ? [2, 4, 8] : [100, 150, 200];
  if (kind === "ml") return setting === "oz" ? [8, 12, 16] : [100, 250, 500];
  return [0.5, 1, 2, 3];
}

/** Digits a typed amount may have: grams five and one decimal, ounces three and one, counts two and two. */
export function typingLimits(unit: string, setting: FoodUnit): { maxInt: number; decimals: number } {
  const kind = normalizeUnit(unit);
  if (kind !== "g" && kind !== "ml") return { maxInt: 2, decimals: 2 };
  return { maxInt: isConverted(unit, setting) ? 3 : 5, decimals: 1 };
}

/** The amount error for a stored amount, worded in the shown unit. */
export function amountErrorIn(amount: number, unit: string, setting: FoodUnit): string | null {
  const error = amountError(amount, unit);
  if (!error || !isConverted(unit, setting)) return error;
  const per = perShown(unit, setting) ?? 1;
  return `Enter an amount above 0 and at most ${Math.floor(METRIC_MAX / per)} ${shownWeightWord(unit, setting)}.`;
}

/** Chip text for a serving the person added: "1 slice = 35 g" or "1 slice = 1.2 oz". */
export function servingLabelIn(name: string, grams: number, setting: FoodUnit): string {
  return setting === "oz" ? `1 ${name} = ${foodAmountLabel(grams, "g", setting)}` : servingChipLabel(name, grams);
}

/** The serving form's error for a weight in grams, worded in the shown unit. */
export function servingErrorIn(name: string, grams: number, setting: FoodUnit): string | null {
  const error = servingDefinitionError(name, grams);
  if (!error || setting !== "oz" || (grams > 0 && grams <= METRIC_MAX)) return error;
  return `Enter a weight above 0 and at most ${Math.floor(METRIC_MAX / G_PER_OZ)} oz.`;
}

/** Unit chips in the shown unit: "g" reads "oz", and a serving the person added gives its size in ounces. */
export function shownChoices(choices: readonly UnitChoice[], setting: FoodUnit): UnitChoice[] {
  return choices.map((choice) => {
    if (choice.named && choice.gramsEach != null) return { ...choice, label: servingLabelIn(choice.unit, choice.gramsEach, setting) };
    if (isConverted(choice.unit, setting)) return { ...choice, label: shownWeightWord(choice.unit, setting) };
    return choice;
  });
}

/**
 * A field filled from a stored amount: its text and the exact amount it came from. 150 g shows as
 * "5.3" oz, and 5.3 oz is 150.25 g, so an untouched field must save the stored 150, not the round trip.
 */
export interface ShownAmount {
  text: string;
  unit: string;
  setting: FoodUnit;
  stored: number;
}

/** Fill a field from a stored amount ("150" g with oz gives text "5.3"), remembering the exact amount. */
export function shownField(stored: string, unit: string, setting: FoodUnit): ShownAmount {
  return { text: shownText(stored, unit, setting), unit, setting, stored: parseAmount(stored) };
}

/** The amount for the API from a field's text: the stored amount while the field still shows it, else the typed value. */
export function readField(text: string, unit: string, setting: FoodUnit, origin: ShownAmount | null | undefined): number {
  if (origin && origin.text === text && origin.unit === unit && origin.setting === setting) return origin.stored;
  return fromShown(parseAmount(text), unit, setting);
}
