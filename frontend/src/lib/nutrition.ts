// Same rounding as the server (half away from zero). The screen shows the
// server's figures; this module is the pin for the worked example and later pages.
export type Sex = "male" | "female";
export type Goal = "lose" | "maintain" | "gain";
export type ActivityKey = "sedentary" | "light" | "moderate" | "very_active" | "athlete";
export type MacroSetting = "less" | "normal" | "more" | "exact";

export const ACTIVITY: Record<ActivityKey, { label: string; hint: string; factor: number }> = {
  sedentary: { label: "Sedentary", hint: "desk, no training", factor: 1.2 },
  light: { label: "Light", hint: "1–3×/wk", factor: 1.375 },
  moderate: { label: "Moderate", hint: "3–5×/wk", factor: 1.55 },
  very_active: { label: "Very active", hint: "6–7×/wk", factor: 1.725 },
  athlete: { label: "Athlete", hint: "2×/day", factor: 1.9 },
};

export const KCAL_PER_KG = 7700;
export const RATES = [0.25, 0.5, 0.75, 1.0] as const;

export const PROTEIN_PRESETS = [
  { key: "less", label: "Less", value: 1.6 },
  { key: "normal", label: "Normal", value: 2.0 },
  { key: "more", label: "More", value: 2.4 },
] as const;
export const FAT_PRESETS = [
  { key: "less", label: "Less", value: 20 },
  { key: "normal", label: "Normal", value: 25 },
  { key: "more", label: "More", value: 30 },
] as const;
export const DEFAULT_PROTEIN = 2.0;
export const DEFAULT_FAT = 25;

const FACTOR_THOUSANDTHS: Record<ActivityKey, number> = {
  sedentary: 1200,
  light: 1375,
  moderate: 1550,
  very_active: 1725,
  athlete: 1900,
};

export interface Targets {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floored: boolean;
}

/** Nearest integer, half away from zero. Input is snapped to 6 dp first so binary noise does not flip a .5. */
export function roundHalfAway(value: number): number {
  const snapped = Math.round(value * 1e6) / 1e6;
  return Math.sign(snapped) * Math.round(Math.abs(snapped));
}

export function calculateTargets(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activity: ActivityKey;
  goal: Goal;
  rateKgPerWeek: number;
  proteinGramsPerKg: number;
  fatPercent: number;
}): Targets {
  const sexOffset = input.sex === "male" ? 5 : -161;
  const bmrExact = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + sexOffset;
  const bmr = roundHalfAway(bmrExact);
  const tdee = roundHalfAway((bmr * FACTOR_THOUSANDTHS[input.activity]) / 1000);
  const perDay = (input.rateKgPerWeek * KCAL_PER_KG) / 7;
  const delta = input.goal === "lose" ? -perDay : input.goal === "gain" ? perDay : 0;
  const raw = tdee + delta;
  const floored = raw < bmr;
  const kcal = floored ? bmr : roundHalfAway(raw);
  const proteinExact = input.proteinGramsPerKg * input.weightKg;
  const protein = roundHalfAway(proteinExact);
  const fatKcal = (kcal * input.fatPercent) / 100;
  const fat = roundHalfAway(fatKcal / 9);
  const carbs = Math.max(0, roundHalfAway((kcal - proteinExact * 4 - fatKcal) / 4));
  return { bmr, tdee, kcal, protein, fat, carbs, floored };
}
