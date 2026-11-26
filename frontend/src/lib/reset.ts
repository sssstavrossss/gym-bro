// Settings → Reset data (README → Reset data): the lines that say what each reset deletes, and the toast
// after it. Training and nutrition reset apart; neither touches the profile, weigh-ins, targets or settings.
import { goalLabel, type PlanGoal } from "./plan";

export interface ResetSummary {
  training: { workouts: number; plan: { goal: PlanGoal; split: string } | null };
  nutrition: { entries: number; days: number; foods: number; recipes: number; groups: number };
}

export type ResetKind = "training" | "nutrition";

/** Read after the reload that follows a reset, for its toast. */
export const RESET_FLASH_KEY = "gymbro-reset-done";

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** "24 workouts · Muscle plan", or "Nothing yet". */
export function trainingLine(summary: ResetSummary["training"]): string {
  const parts = [...(summary.workouts ? [count(summary.workouts, "workout", "workouts")] : []), ...(summary.plan ? [`${goalLabel(summary.plan.goal)} plan`] : [])];
  return parts.length ? parts.join(" · ") : "Nothing yet";
}

/** "1,284 entries over 96 days", or "Nothing logged". */
export function logLine(summary: ResetSummary["nutrition"]): string {
  return summary.entries ? `${count(summary.entries, "entry", "entries")} over ${count(summary.days, "day", "days")}` : "Nothing logged";
}

/** "12 foods · 5 recipes · 3 groups". */
export function ownLine(summary: ResetSummary["nutrition"]): string {
  return [count(summary.foods, "food", "foods"), count(summary.recipes, "recipe", "recipes"), count(summary.groups, "group", "groups")].join(" · ");
}

export function hasTraining(summary: ResetSummary["training"]): boolean {
  return summary.workouts > 0 || summary.plan != null;
}

export function hasNutrition(summary: ResetSummary["nutrition"], foods: boolean): boolean {
  return summary.entries > 0 || summary.days > 0 || (foods && summary.foods + summary.recipes + summary.groups > 0);
}

/** What the confirm says goes and what stays. */
export function confirmLine(kind: ResetKind, summary: ResetSummary, foods = false): string {
  if (kind === "training") {
    const { workouts, plan } = summary.training;
    const gone = [workouts ? `${count(workouts, "workout", "workouts")} with ${workouts === 1 ? "its" : "their"} sets` : "", plan ? "your plan" : ""].filter(Boolean);
    return `${list([...gone, "any workout going on this phone"])} are deleted. Your food log, weigh-ins and targets stay. This can't be undone.`;
  }
  const n = summary.nutrition;
  const gone = [n.entries ? count(n.entries, "log entry", "log entries") : "your closed and fasting days", foods ? "your foods, recipes and groups" : ""].filter(Boolean);
  return `${list(gone)} ${gone.length === 1 && n.entries === 1 ? "is" : "are"} deleted. Your workouts, weigh-ins and targets stay. This can't be undone.`;
}

/** The toast once it's done: "Training reset · 24 workouts deleted". */
export function doneLine(kind: ResetKind, deleted: { workouts?: number; entries?: number; foods?: number; recipes?: number; groups?: number }): string {
  if (kind === "training") return `Training reset · ${count(deleted.workouts ?? 0, "workout", "workouts")} deleted`;
  const own = (deleted.foods ?? 0) + (deleted.recipes ?? 0) + (deleted.groups ?? 0);
  const parts = [count(deleted.entries ?? 0, "entry", "entries"), ...(own ? [count(own, "food, recipe or group", "foods, recipes and groups")] : [])];
  return `Nutrition reset · ${parts.join(" and ")} deleted`;
}

function list(items: string[]): string {
  const text = items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
