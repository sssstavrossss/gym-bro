// Training on Home's week strip and 4-week calendar (README → Home): each day's workouts as an icon for their kind in
// a state (done, skipped, planned), the day card a tapped tile opens, and the four weeks' totals. Pure, so tested.
import { distanceText } from "./cardio";
import { addDays, parse } from "./dates";

export type WorkoutKind = "strength" | "cardio" | "hybrid" | "mobility" | "sport";
export type TrainState = "done" | "skipped" | "planned";

export interface DayWorkout {
  state: TrainState;
  kind: WorkoutKind;
  name: string;
  /** "54 min · 18 sets", "5.2 km · 32 min", "Skipped", "Planned · about 55 min". */
  line: string;
}

/** The icon for each kind (lib/icons.ts). A new kind, such as swimming, gets its own here. */
export const KIND_ICONS: Record<WorkoutKind, string> = {
  strength: "dumbbell",
  cardio: "pulse",
  hybrid: "bolt",
  mobility: "stretch",
  sport: "trophy",
};
export const KIND_ORDER: readonly WorkoutKind[] = ["strength", "cardio", "hybrid", "mobility", "sport"];

/** A kind as the server stores it. Anything unknown (or none) reads as strength, the server's own default. */
export function kindOf(value: string | null | undefined): WorkoutKind {
  return value && (KIND_ORDER as readonly string[]).includes(value) ? (value as WorkoutKind) : "strength";
}

export interface SavedWorkout {
  id: string;
  date: string;
  kind: string;
  name: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  sets: number;
  metres?: number;
}
export interface WaitingWorkout {
  id: string;
  date: string;
  name: string | null;
  skipped?: boolean;
  plan?: { workoutId: string } | null;
}
export interface ComingWorkout {
  date: string;
  workout: { id: string; name: string; minutes: number };
}

function minutesOf(row: Pick<SavedWorkout, "startedAt" | "endedAt">): number | null {
  if (!row.startedAt || !row.endedAt) return null;
  const minutes = Math.round((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60_000);
  return minutes > 0 ? minutes : null;
}

/** A saved workout's line: distance first for one that covered any, else its sets. */
export function savedLine(row: SavedWorkout): string {
  if (row.status === "skipped") return "Skipped";
  const minutes = minutesOf(row);
  const parts = row.metres
    ? [distanceText(row.metres), minutes != null ? `${minutes} min` : ""]
    : [minutes != null ? `${minutes} min` : "", row.sets ? `${row.sets} ${row.sets === 1 ? "set" : "sets"}` : ""];
  return parts.filter(Boolean).join(" · ") || "Done";
}

const RANK: Record<TrainState, number> = { done: 0, skipped: 1, planned: 2 };

/**
 * Each day's workouts, done first, then skipped, then planned; the first is the one its badge shows. Saved workouts
 * come from the history, ones waiting to send count as done (or skipped) with the plan's kind when they're from it,
 * and the plan's coming days are planned unless that day already has a plan workout done or skipped.
 */
export function trainingByDay(
  saved: readonly SavedWorkout[],
  waiting: readonly WaitingWorkout[],
  coming: readonly ComingWorkout[],
  kinds: Readonly<Record<string, string>> | undefined,
): Record<string, DayWorkout[]> {
  const days: Record<string, DayWorkout[]> = {};
  const add = (date: string, item: DayWorkout) => (days[date] ??= []).push(item);
  const ids = new Set(saved.map((row) => row.id));
  for (const row of saved) {
    add(row.date, { state: row.status === "skipped" ? "skipped" : "done", kind: kindOf(row.kind), name: row.name ?? "Workout", line: savedLine(row) });
  }
  for (const draft of waiting) {
    if (ids.has(draft.id)) continue;
    const kind = kindOf(draft.plan ? kinds?.[draft.plan.workoutId] : null);
    add(draft.date, { state: draft.skipped ? "skipped" : "done", kind, name: draft.name ?? "Workout", line: draft.skipped ? "Skipped" : "Waiting to send" });
  }
  for (const day of coming) {
    if (days[day.date]?.length) continue;
    add(day.date, { state: "planned", kind: kindOf(kinds?.[day.workout.id]), name: day.workout.name, line: `Planned · about ${day.workout.minutes} min` });
  }
  for (const list of Object.values(days)) list.sort((a, b) => RANK[a.state] - RANK[b.state]);
  return days;
}

/** ", Upper A done", ", Run skipped, Mobility done", or "" on a rest day: added to a day's screen-reader name. */
export function trainingSaid(list: readonly DayWorkout[] | undefined): string {
  if (!list?.length) return "";
  return list.map((item) => `, ${item.name} ${item.state}`).join("");
}

/** The calories line on a tapped day's card. Within 5% reads on target, as the tile's tick does; else how far off. */
export function kcalLine(date: string, today: string, logged: boolean, kcal: number | null, target: number | null): string {
  if (date > today) return logged ? "Food planned" : "Nothing planned";
  if (!logged || kcal == null) return "Nothing logged";
  const amount = `${Math.round(kcal).toLocaleString("en-GB")} kcal`;
  if (target == null || target <= 0) return amount;
  const off = Math.round(kcal - target);
  if (Math.abs(off) <= target * 0.05) return `${amount} · on target`;
  return `${amount} · ${Math.abs(off).toLocaleString("en-GB")} ${off > 0 ? "over" : "under"}`;
}

const CARD_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** The card's title: "Today", "Yesterday", or "Sat 21 Nov". */
export function cardTitle(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return CARD_DAY.format(parse(date)).replace(",", "");
}

export interface FourWeekTotals {
  /** Logged days within 10% of their target. */
  onTarget: number;
  done: number;
  skipped: number;
  weighIns: number;
  /** Days from the first shown (or setup, if later) through today. */
  days: number;
}

/**
 * The four weeks' totals under the calendar, up to today: days on target (shades "on" and "close" are within 10%),
 * workouts done and skipped, and weigh-ins out of the days so far. Days before setup count only their workouts (one
 * imported from another app can be older).
 */
export function fourWeekTotals(
  dates: readonly string[],
  today: string,
  setupDate: string,
  shades: Readonly<Record<string, string>>,
  training: Readonly<Record<string, readonly DayWorkout[]>>,
  weighIns: ReadonlySet<string>,
): FourWeekTotals {
  const totals: FourWeekTotals = { onTarget: 0, done: 0, skipped: 0, weighIns: 0, days: 0 };
  for (const date of dates) {
    if (date > today) continue;
    for (const item of training[date] ?? []) {
      if (item.state === "done") totals.done += 1;
      else if (item.state === "skipped") totals.skipped += 1;
    }
    if (setupDate && date < setupDate) continue;
    totals.days += 1;
    if (shades[date] === "on" || shades[date] === "close") totals.onTarget += 1;
    if (weighIns.has(date)) totals.weighIns += 1;
  }
  return totals;
}
