// Which cards the Train page shows (views/TrainView.vue), the week under Up next, and the workout Repeat starts again.
// Pure, so the rules are tested.
import { addDays, parse } from "./dates";
import { weekdayOf } from "./plan";

export type LoadState = "idle" | "loading" | "ready" | "failed";

export interface TrainInput {
  /** A workout is going on this phone. */
  active: boolean;
  /** The plan's load state, and whether there is one. */
  planState: LoadState;
  hasPlan: boolean;
  /** Workout history's load state and how many rows it has, with finished ones still waiting to send. */
  historyState: LoadState;
  historyRows: number;
  waiting: number;
}

export interface TrainCards {
  /** "Workout in progress" with Resume, at the top. */
  inProgress: boolean;
  /** Start a workout (no plan) or Something else today (a plan): empty or described. Not while one runs. */
  start: boolean;
  /** Make a plan, once the plan has loaded and there is none. */
  makePlan: boolean;
  /** Explore the library, for someone without a plan yet. */
  explore: boolean;
  /** "Trained before?": log what you did, once history has loaded and holds nothing. */
  trainedBefore: boolean;
  /** History, once it holds something (or failed to load, to say so and try again). */
  history: boolean;
}

export function trainCards(input: TrainInput): TrainCards {
  const noPlan = input.planState === "ready" && !input.hasPlan;
  const anyHistory = input.historyRows > 0 || input.waiting > 0;
  return {
    inProgress: input.active,
    start: !input.active,
    makePlan: noPlan,
    explore: noPlan,
    trainedBefore: input.historyState === "ready" && !anyHistory,
    history: anyHistory || input.historyState === "failed",
  };
}

/** The Start a workout card's title and caption. `repeat` names the workout Repeat starts again (null: unnamed), when there is one. */
export function startText(hasPlan: boolean, canDescribe: boolean, repeat?: RepeatSource | null): { title: string; caption: string } {
  const title = hasPlan ? "Something else today?" : "Start a workout";
  if (repeat) {
    const again = `repeat ${repeatName(repeat)}`;
    return { title, caption: canDescribe ? `Empty, describe it, or ${again}` : `Empty, or ${again}` };
  }
  if (hasPlan) return { title, caption: canDescribe ? "Off the plan: add exercises as you go, or describe it" : "Off the plan: add exercises as you go" };
  return { title, caption: canDescribe ? "Add exercises as you go, or describe it" : "Add exercises as you go and tick off each set" };
}

/** A workout Repeat can start again: its name and its exercises in order. */
export interface RepeatSource {
  name: string | null;
  exercises: string[];
}

/**
 * The last workout done: the newest finished one still waiting to send, else the newest saved one that was done
 * (not skipped). One without exercises can't be repeated.
 */
export function lastWorkout(
  pending: readonly { name: string | null; exercises: readonly { exerciseId: string }[]; skipped?: boolean }[],
  rows: readonly { name: string | null; status: string; exercises: readonly string[] }[],
): RepeatSource | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    const draft = pending[i];
    const ids = unique(draft.exercises.map((exercise) => exercise.exerciseId));
    if (!draft.skipped && ids.length) return { name: draft.name, exercises: ids };
  }
  const row = rows.find((item) => item.status === "done" && item.exercises.length);
  return row ? { name: row.name, exercises: unique(row.exercises) } : null;
}

/** "Lower B", or "your last workout" for one without a name. */
export function repeatName(source: RepeatSource): string {
  return source.name ?? "your last workout";
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export type DiscState = "done" | "skipped" | "today" | "planned" | "rest";

export interface WeekDisc {
  date: string;
  /** "M" … "S". */
  letter: string;
  /** The day of the month. */
  number: number;
  state: DiscState;
  /** The plan workout that falls on it, today or later. */
  workout: string | null;
  /** What a screen reader says: "Thu 26 Nov, Upper A, today". */
  label: string;
}

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * This week, Monday to Sunday, for Up next: a day with a workout done is done, one with only a skip is skipped,
 * today is today, and a coming day with a plan workout on it (lib/plan.ts `projectDays`) is planned. The rest are rest.
 */
export function weekDiscs(
  today: string,
  coming: readonly { date: string; workout: { name: string } }[],
  done: readonly string[],
  skipped: readonly string[],
): WeekDisc[] {
  const monday = addDays(today, -weekdayOf(today));
  return LETTERS.map((letter, index) => {
    const date = addDays(monday, index);
    const workout = date >= today ? coming.find((day) => day.date === date)?.workout.name ?? null : null;
    const state: DiscState = done.includes(date) ? "done"
      : skipped.includes(date) ? "skipped"
      : date === today ? "today"
      : workout ? "planned" : "rest";
    const said = state === "done" ? "trained"
      : state === "skipped" ? "skipped"
      : state === "today" ? [workout, "today"].filter(Boolean).join(", ")
      : workout ?? (date > today ? "rest day" : "");
    const day = DAY_FORMAT.format(parse(date)).replace(",", "");
    return { date, letter, number: parse(date).getDate(), state, workout, label: said ? `${day}, ${said}` : day };
  });
}
