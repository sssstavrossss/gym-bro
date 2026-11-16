import { int } from "./format";

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

/** Grams (and kcal) eaten, or about to be added. */
export interface MacroAmounts {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

/** A day's targets, as the targets endpoint names them. */
export interface MacroGoal {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface MacroRow {
  kind: MacroKind;
  label: string;
  unit: string;
  /** Protein is a minimum: it can't go over. */
  min: boolean;
  current: number;
  target: number;
  status: MacroStatus;
  /** "278 left", "112 to go" or "+58 over". Empty on target, where the row has a tick. */
  tag: string;
  /** Bar length, current ÷ target. */
  fraction: number;
  /** The end of the bar that is being added now, as a share of the target. */
  added: number;
  /** The amount being added. */
  adding: number;
}

/** The tag beside a macro: what is left while under, how far over once over, nothing on target. */
export function macroTag(kind: MacroKind, current: number, target: number): string {
  const status = macroStatus(kind, current, target);
  if (status === "over") return `+${int(current - target)} over`;
  if (status === "under") return `${int(target - current)} ${kind === "p" ? "to go" : "left"}`;
  return "";
}

/**
 * The Macros card's four rows. `eaten` is the day's total, including `adding` when the food
 * sheet shows the day after a food is added.
 */
export function macroRows(goal: MacroGoal, eaten: MacroAmounts, adding?: MacroAmounts | null): MacroRow[] {
  const rows: { kind: MacroKind; label: string; unit: string; target: number }[] = [
    { kind: "kcal", label: "Calories", unit: "kcal", target: goal.kcal },
    { kind: "p", label: "Protein", unit: "g", target: goal.protein },
    { kind: "f", label: "Fat", unit: "g", target: goal.fat },
    { kind: "c", label: "Carbs", unit: "g", target: goal.carbs },
  ];
  return rows.map(({ kind, label, unit, target }) => {
    const current = eaten[kind];
    const part = adding ? Math.max(0, adding[kind]) : 0;
    return {
      kind,
      label,
      unit,
      min: kind === "p",
      current,
      target,
      status: macroStatus(kind, current, target),
      tag: macroTag(kind, current, target),
      fraction: target > 0 ? current / target : 0,
      added: target > 0 ? part / target : 0,
      adding: part,
    };
  });
}
