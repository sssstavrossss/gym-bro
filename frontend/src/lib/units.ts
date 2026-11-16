import { formatDecimal, roundHalfAwayFromZero, signed } from "./format";
import { atMostOneDecimal, formatMeasure, parseDecimal } from "./numbers";

/**
 * Display units. The API and the database stay metric: kilograms (two decimals, so a weight typed in pounds
 * comes back as typed) and centimetres. Only what is shown and typed changes. Food stays in grams.
 */
export type WeightUnit = "kg" | "lb";
export type HeightUnit = "cm" | "ftin";

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;
const MIN_KG = 30;
const MAX_KG = 300;
const MIN_CM = 100;
const MAX_CM = 250;

export function weightUnitOf(value: unknown): WeightUnit {
  return value === "lb" ? "lb" : "kg";
}

export function heightUnitOf(value: unknown): HeightUnit {
  return value === "ftin" ? "ftin" : "cm";
}

/** Kilograms in the shown unit, unrounded. Charts scale on this. */
export function kgTo(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kg / KG_PER_LB : kg;
}

/** A shown weight back to kilograms: pounds keep two kilogram decimals. */
export function toKg(value: number, unit: WeightUnit): number {
  return unit === "lb" ? roundHalfAwayFromZero(value * KG_PER_LB, 2) : value;
}

/** The number only, e.g. "83.6" or "184.3". */
export function weightText(kg: number, unit: WeightUnit, digits = 1): string {
  return formatDecimal(kgTo(kg, unit), digits);
}

/** A change, with its sign: "+0.4", "−1.1". */
export function signedWeight(kg: number, unit: WeightUnit, digits = 1): string {
  return signed(kgTo(kg, unit), digits);
}

/** The weigh-in and goal range in the shown unit: 30–300 kg, or 66.2–661.3 lb (the pounds that land inside it). */
export function weightRange(unit: WeightUnit): { min: string; max: string } {
  if (unit === "kg") return { min: String(MIN_KG), max: String(MAX_KG) };
  return {
    min: formatDecimal(Math.ceil((MIN_KG / KG_PER_LB) * 10) / 10),
    max: formatDecimal(Math.floor((MAX_KG / KG_PER_LB) * 10) / 10),
  };
}

/** Typed weight (one decimal, comma or point) in the shown unit to kilograms. Null when it isn't one or is out of range. */
export function parseWeight(raw: string, unit: WeightUnit): number | null {
  const value = parseDecimal(raw);
  if (value == null || !atMostOneDecimal(value)) return null;
  const kg = toKg(value, unit);
  return kg >= MIN_KG && kg <= MAX_KG ? kg : null;
}

export function weightRangeError(label: string, unit: WeightUnit): string {
  const range = weightRange(unit);
  return `${label} should be between ${range.min} and ${range.max} ${unit}, with one decimal.`;
}

/** Goal weight for the form: whole numbers stay bare ("75", "165.3"). */
export function goalText(kg: number, unit: WeightUnit): string {
  const rounded = roundHalfAwayFromZero(kgTo(kg, unit));
  return Number.isInteger(rounded) ? String(rounded) : formatDecimal(rounded);
}

/** A rate chip: the kilogram steps, or their exact pounds (0.6, 1.1, 1.7, 2.2). */
export function rateText(rateKg: number, unit: WeightUnit): string {
  if (unit === "lb") return formatDecimal(rateKg / KG_PER_LB);
  return Math.abs(rateKg - 1) < 1e-6 ? "1.0" : String(rateKg);
}

/** Centimetres to feet and inches, inches to one decimal. */
export function cmToFtIn(cm: number): { ft: number; inches: number } {
  const total = roundHalfAwayFromZero(cm / CM_PER_INCH);
  const ft = Math.floor(total / 12);
  return { ft, inches: roundHalfAwayFromZero(total - ft * 12) };
}

export function ftInToCm(ft: number, inches: number): number {
  return roundHalfAwayFromZero((ft * 12 + inches) * CM_PER_INCH);
}

/** "182 cm" or "5 ft 11.7 in". */
export function heightText(cm: number, unit: HeightUnit): string {
  if (unit === "cm") return `${formatMeasure(cm)} cm`;
  const { ft, inches } = cmToFtIn(cm);
  return `${ft} ft ${formatMeasure(inches)} in`;
}

/** Feet (whole) and inches (under 12, one decimal; blank is 0) to centimetres. Null when it isn't a height from 100 to 250 cm. */
export function parseFtIn(ftRaw: string, inRaw: string): number | null {
  if (!/^\s*\d{1,2}\s*$/.test(ftRaw)) return null;
  const inches = inRaw.trim() === "" ? 0 : parseDecimal(inRaw);
  if (inches == null || !atMostOneDecimal(inches) || inches >= 12) return null;
  const cm = ftInToCm(Number(ftRaw), inches);
  return cm >= MIN_CM && cm <= MAX_CM ? cm : null;
}

export function heightRangeError(unit: HeightUnit): string {
  if (unit === "cm") return `Height should be between ${MIN_CM} and ${MAX_CM} cm, with at most one decimal.`;
  return `Height should be between ${heightText(MIN_CM, "ftin")} and ${heightText(MAX_CM, "ftin")}.`;
}

/** The sentence under "Is N right?" in the typo guard. Same rounding as the API error. */
export function typoGuardDetail(kgValue: number, previousTrendKg: number, unit: WeightUnit): string {
  const diff = kgValue - previousTrendKg;
  const way = diff < 0 ? "below" : "above";
  return `That's ${weightText(Math.abs(diff), unit)} ${unit} ${way} your trend (${weightText(previousTrendKg, unit)} ${unit}). Nothing is saved until you choose.`;
}

export function typoGuardSentence(kgValue: number, previousTrendKg: number, unit: WeightUnit): string {
  return `Is ${weightText(kgValue, unit)} ${unit} right? ${typoGuardDetail(kgValue, previousTrendKg, unit)}`;
}
