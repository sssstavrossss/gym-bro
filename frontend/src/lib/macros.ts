/** Decision 7. Protein meets a minimum. Calories use ±5 %. Fat and carbs use ±10 %. */
export type MacroKind = "kcal" | "p" | "f" | "c";
export type MacroStatus = "under" | "hit" | "over";

export function macroStatus(kind: MacroKind, current: number, target: number): MacroStatus {
  if (kind === "p") return current >= target ? "hit" : "under";
  const band = kind === "kcal" ? 0.05 : 0.1;
  if (current > target * (1 + band)) return "over";
  if (current >= target * (1 - band)) return "hit";
  return "under";
}

/** 4 kcal per gram of protein or carbs, 9 per gram of fat. Quick add only. */
export function kcalFromMacros(protein: number, fat: number, carbs: number): number {
  return protein * 4 + fat * 9 + carbs * 4;
}
