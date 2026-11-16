import { addDays, parse } from "./dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type GoalLine =
  | { kind: "way"; fromKg: number; toKg: number; leftKg: number; weeks: number; by: string }
  | { kind: "reached" };

/** Under 0.1 kg away counts as there: weigh-ins are kept to one decimal. */
const THERE = 0.05;

/**
 * The line under Goal: how far the goal weight is and roughly when it lands at the chosen rate.
 * Null when there is nothing to estimate (maintain, no weight yet, no rate).
 */
export function goalLine(input: { goal: string; weightKg: number | null; goalKg: number | null; rateKg: number | null; today: string }): GoalLine | null {
  const { goal, weightKg, goalKg, rateKg, today } = input;
  if (goal !== "lose" && goal !== "gain") return null;
  if (weightKg == null || goalKg == null || !Number.isFinite(weightKg) || !Number.isFinite(goalKg)) return null;
  const left = goal === "lose" ? weightKg - goalKg : goalKg - weightKg;
  if (left <= THERE) return { kind: "reached" };
  if (rateKg == null || !(rateKg > 0)) return null;
  const weeks = Math.ceil(left / rateKg - 1e-9);
  return { kind: "way", fromKg: weightKg, toKg: goalKg, leftKg: left, weeks, by: roughDate(addDays(today, weeks * 7), today) };
}

/** "late Feb", or "early Mar 2028" when the year differs from today's. */
export function roughDate(isoDate: string, today: string): string {
  const date = parse(isoDate);
  const day = date.getDate();
  const part = day <= 10 ? "early" : day <= 20 ? "mid" : "late";
  const year = date.getFullYear() === parse(today).getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${part} ${MONTHS[date.getMonth()]}${year}`;
}
