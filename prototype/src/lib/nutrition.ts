export type Sex = "male" | "female";
export type Goal = "lose" | "maintain" | "gain";
export type ActivityKey = "sedentary" | "light" | "moderate" | "very" | "athlete";

export const ACTIVITY: Record<ActivityKey, { label: string; hint: string; factor: number }> = {
  sedentary: { label: "Sedentary", hint: "desk, no training", factor: 1.2 },
  light: { label: "Light", hint: "1–3×/wk", factor: 1.375 },
  moderate: { label: "Moderate", hint: "3–5×/wk", factor: 1.55 },
  very: { label: "Very active", hint: "6–7×/wk", factor: 1.725 },
  athlete: { label: "Athlete", hint: "2×/day", factor: 1.9 },
};

export const KCAL_PER_KG = 7700;
export const RATES = [0.25, 0.5, 0.75, 1.0];

/** Macro balance presets (Profile → Customise). Normal = the default. */
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

export interface Profile {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activity: ActivityKey;
  goal: Goal;
  rate: number; // kg per week
  goalWeight: number; // kg, used for the "80 kg around …" hint
  startWeight: number; // kg from setup; used for targets until the first weigh-in exists
  proteinPerKg: number; // g per kg body weight
  fatPct: number; // % of target kcal
  /** S7: "rate" = from goal + rate; "manual" = my own daily kcal */
  goalMode?: "rate" | "manual";
  /** S7: kept when switching back to rate, pre-filled when switching to manual again */
  manualKcal?: number;
  /** S7: direction when the manual number was set (trend above goal → lose), for the goal-reached question */
  manualDir?: "lose" | "gain";
}

export interface Targets {
  weight: number;
  age: number;
  bmr: number;
  tdee: number;
  delta: number; // kcal/day vs burn (negative = deficit)
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  floored: boolean; // target raised to BMR (calorie floor, decision 12) — rate mode only
  manual: boolean; // S7
  belowBmr: boolean; // S7: manual number under BMR, kept with a neutral warning
  fatCut: boolean; // S7: protein + fat didn't fit, fat reduced, carbs 0
}
export const MANUAL_MIN = 1200, MANUAL_MAX = 5000, MANUAL_STEP = 10;
/** "2000", "2 000", "2,000" → 2000; null with a plain-language error otherwise (S7 validation) */
export function parseManualKcal(raw: string): { v: number | null; err: string | null } {
  const t = raw.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!t) return { v: null, err: "Enter a daily calorie number, e.g. 2000." };
  // a comma or point followed by exactly 3 digits is a thousands separator; anything else is a decimal
  const m = t.match(/^(\d{1,2})[.,](\d{3})$/);
  const n = m ? Number(m[1] + m[2]) : /^\d+$/.test(t) ? Number(t) : NaN;
  if (Number.isNaN(n)) return { v: null, err: /[.,]/.test(t) ? "Use a whole number of kcal — no decimals." : "Use numbers only, e.g. 2000." };
  if (n < MANUAL_MIN || n > MANUAL_MAX) return { v: null, err: `Pick a number between 1,200 and 5,000 kcal.` };
  if (n % MANUAL_STEP) return { v: null, err: `Use steps of 10 kcal, e.g. ${Math.round(n / 10) * 10}.` };
  return { v: n, err: null };
}

/** Mifflin-St Jeor */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

export function targets(p: Profile, weightKg: number, year: number): Targets {
  const age = year - p.birthYear;
  const b = bmr(p.sex, weightKg, p.heightCm, age);
  const tdee = b * ACTIVITY[p.activity].factor;
  const protein0 = p.proteinPerKg * weightKg;
  if (p.goalMode === "manual" && p.manualKcal) {
    // S7: the number is deliberate — no floor; macros from the trend weight; fat gives way if needed
    const kcal = p.manualKcal;
    let fat = (kcal * p.fatPct) / 100 / 9;
    let fatCut = false;
    if (protein0 * 4 + fat * 9 > kcal) { fat = Math.max(0, (kcal - protein0 * 4) / 9); fatCut = true; }
    const carbs = Math.max(0, (kcal - protein0 * 4 - fat * 9) / 4);
    return { weight: weightKg, age, bmr: b, tdee, delta: kcal - tdee, kcal, protein: protein0, fat, carbs, floored: false, manual: true, belowBmr: kcal < b, fatCut };
  }
  const perDay = (p.rate * KCAL_PER_KG) / 7;
  const delta = p.goal === "lose" ? -perDay : p.goal === "gain" ? perDay : 0;
  const raw = tdee + delta;
  const floored = raw < b;
  const kcal = Math.max(raw, b);
  const protein = p.proteinPerKg * weightKg;
  const fat = (kcal * p.fatPct) / 100 / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { weight: weightKg, age, bmr: b, tdee, delta, kcal, protein, fat, carbs, floored, manual: false, belowBmr: false, fatCut: false };
}

/** kcal from macros (4 · 9 · 4) */
export const kcalFromMacros = (p: number, f: number, c: number) => p * 4 + f * 9 + c * 4;

/** S7: implied weekly change for a daily kcal, information only: (kcal − burn) × 7 ÷ 7,700 */
export const impliedKgPerWeek = (tdee: number, kcal: number) => ((kcal - tdee) * 7) / KCAL_PER_KG;
