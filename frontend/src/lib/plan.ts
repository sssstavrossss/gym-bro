// Training plans (docs/training.md, phase 3; README → Training plans). The server makes the workouts;
// this file holds the setup's choices, their labels and the lines the app shows.
import { distanceText } from "./cardio";
import { addDays, parse } from "./dates";

export type PlanGoal = "muscle" | "strength" | "fitness" | "hyrox";
export type Experience = "new" | "some" | "experienced";
export type EquipmentPreset = "gym" | "home" | "dumbbells" | "kettlebells" | "bodyweight";
export type Joint = "shoulders" | "elbows" | "wrists" | "lower-back" | "hips" | "knees" | "ankles";
export type Split = "full_body" | "upper_lower" | "push_pull_legs" | "ppl_upper_lower" | "custom" | "hyrox";

export interface PlanExercise {
  exerciseId: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  /** A hold's target, in seconds, instead of reps. */
  seconds: number | null;
  restSeconds: number;
  /** A run's, row's or carry's distance. Missing from plans made before it was added. */
  metres?: number | null;
  /** Joined to the exercise before, as a circuit (lib/workout.ts `superset`). */
  superset?: boolean;
  /** On a circuit's first exercise: done on the clock (lib/timed.ts): for time, or an EMOM or AMRAP of `minutes`. */
  format?: "for_time" | "emom" | "amrap" | null;
  minutes?: number | null;
}

export interface PlanWorkout {
  id: string;
  name: string;
  /** The estimate, to the nearest 5. */
  minutes: number;
  exercises: PlanExercise[];
  /** Changed by hand in the editor. Remaking the plan from the answers drops it. */
  edited?: boolean;
  /** Dynamic moves before its exercises and stretches after, when the plan has them on; null when off. */
  warmUp?: PlanExercise[] | null;
  coolDown?: PlanExercise[] | null;
}

/** The setup's answers, as `PUT /api/plan` takes them. Null takes the server's default. */
export interface PlanAnswers {
  goal: PlanGoal;
  /** 0 = Monday. */
  weekdays: number[];
  minutes: number;
  experience: Experience;
  equipment: EquipmentPreset[];
  goEasy: Joint[];
  easeIn: boolean | null;
  split: Split | null;
  /** A mobility warm-up and a cool-down of stretches in each workout. Off unless on. */
  warmUp: boolean;
  coolDown: boolean;
}

export interface Plan {
  id: string;
  goal: PlanGoal;
  weekdays: number[];
  minutes: number;
  experience: Experience;
  equipment: EquipmentPreset[];
  goEasy: Joint[];
  easeIn: boolean;
  split: Split;
  warmUp: boolean;
  coolDown: boolean;
  blockWeeks: number;
  startDate: string;
  updatedAt: string;
  workouts: PlanWorkout[];
  /** The highest place in the sequence done or skipped from this plan's workouts, or null before the first. */
  lastPosition: number | null;
  /** Each workout's kind by its id, as it will be saved once done (strength, cardio, hybrid, mobility, sport). Absent from an older server. */
  kinds?: Record<string, string>;
}

export interface PlanPreview {
  split: Split;
  easeIn: boolean;
  warmUp: boolean;
  coolDown: boolean;
  blockWeeks: number;
  workouts: PlanWorkout[];
}

export const GOALS: { value: PlanGoal; label: string }[] = [
  { value: "muscle", label: "Muscle" },
  { value: "strength", label: "Strength" },
  { value: "fitness", label: "Fitness" },
  { value: "hyrox", label: "Hyrox" },
];

export const EXPERIENCES: { value: Experience; label: string }[] = [
  { value: "new", label: "New" },
  { value: "some", label: "Some" },
  { value: "experienced", label: "Experienced" },
];

export const EQUIPMENT: { id: EquipmentPreset; label: string }[] = [
  { id: "gym", label: "Full gym" },
  { id: "home", label: "Home gym" },
  { id: "dumbbells", label: "Dumbbells" },
  { id: "kettlebells", label: "Kettlebells" },
  { id: "bodyweight", label: "Body weight" },
];

export const JOINTS: { id: Joint; label: string }[] = [
  { id: "shoulders", label: "Shoulders" },
  { id: "elbows", label: "Elbows" },
  { id: "wrists", label: "Wrists" },
  { id: "lower-back", label: "Lower back" },
  { id: "hips", label: "Hips" },
  { id: "knees", label: "Knees" },
  { id: "ankles", label: "Ankles" },
];

export const SPLITS: { id: Split; label: string }[] = [
  { id: "full_body", label: "Full body" },
  { id: "upper_lower", label: "Upper / Lower" },
  { id: "push_pull_legs", label: "Push / Pull / Legs" },
  { id: "ppl_upper_lower", label: "Push / Pull / Legs + Upper / Lower" },
  { id: "custom", label: "Your own" },
  { id: "hyrox", label: "Hyrox" },
];

/** The splits a goal can take: Hyrox has its own (or your own), and the others don't take it. */
export function splitsFor(goal: PlanGoal): typeof SPLITS {
  return SPLITS.filter((item) => item.id === "custom" || (item.id === "hyrox") === (goal === "hyrox"));
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const MIN_MINUTES = 10;
export const MAX_MINUTES = 120;
export const MINUTE_STEP = 5;

export function defaultAnswers(): PlanAnswers {
  return { goal: "muscle", weekdays: [0, 2, 4], minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], easeIn: null, split: null, warmUp: false, coolDown: false };
}

/** A saved plan's answers, for editing it. */
export function answersOf(plan: Plan): PlanAnswers {
  return {
    goal: plan.goal,
    weekdays: [...plan.weekdays],
    minutes: plan.minutes,
    experience: plan.experience,
    equipment: [...plan.equipment],
    goEasy: [...plan.goEasy],
    easeIn: plan.easeIn,
    split: plan.split,
    // A plan from before these settings has neither.
    warmUp: plan.warmUp ?? false,
    coolDown: plan.coolDown ?? false,
  };
}

/** The split that follows from the goal and the days a week, as the server picks it. */
export function splitFor(days: number, goal?: PlanGoal): Split {
  if (goal === "hyrox") return "hyrox";
  if (days <= 3) return "full_body";
  if (days === 4) return "upper_lower";
  if (days === 5) return "ppl_upper_lower";
  return "push_pull_legs";
}

/** Ease in is on for New and for anyone going easy on an area, unless switched. */
export function easeInFor(answers: PlanAnswers): boolean {
  return answers.easeIn ?? (answers.experience === "new" || answers.goEasy.length > 0);
}

export function splitLabel(split: Split): string {
  return SPLITS.find((item) => item.id === split)?.label ?? split;
}

export function goalLabel(goal: PlanGoal): string {
  return GOALS.find((item) => item.value === goal)?.label ?? goal;
}

/** Five minutes more or less, kept from 10 to 120. */
export function stepMinutes(minutes: number, delta: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes + delta));
}

/** Adds the item when it's missing, takes it out when it's there; keeps the list's own order. */
export function toggled<T>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  return order.filter((value) => next.includes(value));
}

export function setCount(workout: PlanWorkout): number {
  return workout.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
}

/** "6 exercises · 16 sets · ~55 min", "5 exercises · 2 rounds · ~45 min" for a circuit; "No exercises yet" for one of your own not filled in. */
export function workoutLine(workout: PlanWorkout): string {
  const count = workout.exercises.length;
  if (!count) return EMPTY_WORKOUT;
  const [first] = workout.exercises;
  if (first.format && workout.exercises.every((item, index) => index === 0 || item.superset)) {
    return `${count} ${count === 1 ? "exercise" : "exercises"} · ${first.sets} ${first.sets === 1 ? "round" : "rounds"} · ~${workout.minutes} min`;
  }
  // A finisher on the clock is its minutes, not its sets: "6 exercises · 12 sets + EMOM 10 min · ~45 min".
  const finisher = finisherOf(workout);
  const sets = setCount(finisher ? { ...workout, exercises: workout.exercises.slice(0, finisher.at) } : workout);
  const tail = finisher ? ` + ${finisher.label}` : "";
  return `${count} ${count === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"}${tail} · ~${workout.minutes} min`;
}

/** "Muscle · Upper / Lower · 4 days · 60 min", "Hyrox · 4 days · 45 min" */
export function planLine(plan: Pick<Plan, "goal" | "split" | "weekdays" | "minutes">): string {
  const days = plan.weekdays.length;
  const split = plan.split === "hyrox" ? [] : [splitLabel(plan.split)];
  return [goalLabel(plan.goal), ...split, `${days} ${days === 1 ? "day" : "days"}`, `${plan.minutes} min`].join(" · ");
}

export const EMPTY_WORKOUT = "No exercises yet";

/** "With a warm-up and cool-down", "With a warm-up", "With a cool-down", or "" when it has neither. */
/** The mobility warm-up's and cool-down's minutes each, on top of a workout's own (server `Mobility.PartSeconds`). */
export const MOBILITY_MINUTES = 3;

/** "+ 3 min warm-up · 3 min cool-down", or just the one, or "": what a workout adds to its own minutes. */
export function mobilityLine(workout: Pick<PlanWorkout, "warmUp" | "coolDown">): string {
  const parts = [workout.warmUp?.length ? `${MOBILITY_MINUTES} min warm-up` : "", workout.coolDown?.length ? `${MOBILITY_MINUTES} min cool-down` : ""].filter(Boolean);
  return parts.length ? `+ ${parts.join(" · ")}` : "";
}

/** One workout, as Update plan shows it: now and once updated. */
export interface WorkoutChange {
  name: string;
  minutesNow: number;
  minutesNew: number;
  setsNow: number;
  setsNew: number;
  /** Exercise ids it gains and loses, in the workout's order. */
  added: string[];
  removed: string[];
  /** Edited by hand, so updating makes it again. */
  edited: boolean;
}

const setsOf = (workout: PlanWorkout) => workout.exercises.reduce((total, item) => total + item.sets, 0);

/** Each of the updated plan's workouts against the one it replaces (same name, else the same place). */
export function workoutChanges(current: readonly PlanWorkout[], next: readonly PlanWorkout[]): WorkoutChange[] {
  return next.map((item, index) => {
    const was = current.find((workout) => workout.name === item.name) ?? current[index];
    const before = was?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const after = item.exercises.map((exercise) => exercise.exerciseId);
    return {
      name: item.name,
      minutesNow: was?.minutes ?? 0,
      minutesNew: item.minutes,
      setsNow: was ? setsOf(was) : 0,
      setsNew: setsOf(item),
      added: after.filter((id) => !before.includes(id)),
      removed: before.filter((id) => !after.includes(id)),
      edited: was?.edited ?? false,
    };
  });
}

/** "~40 → ~45 min · 15 → 18 sets", then "+ Lateral raise · − Curl"; or just "No change". */
export function workoutChangeLines(change: WorkoutChange, nameOf: (id: string) => string): string[] {
  const sizes = [
    change.minutesNow !== change.minutesNew ? `~${change.minutesNow} → ~${change.minutesNew} min` : "",
    change.setsNow !== change.setsNew ? `${change.setsNow} → ${change.setsNew} sets` : "",
  ].filter(Boolean).join(" · ");
  const swaps = [...change.added.map((id) => `+ ${nameOf(id)}`), ...change.removed.map((id) => `− ${nameOf(id)}`)].join(" · ");
  const lines = [sizes, swaps].filter(Boolean);
  return lines.length ? lines : ["No change"];
}

/**
 * Saving answers for your own plan keeps its workouts; fewer days drop the last ones. These are their names, or
 * none when nothing would go (or when the plan is made again anyway).
 */
export function droppedOwn(current: Pick<Plan, "split" | "workouts"> | null, split: Split, days: number): string[] {
  if (!current || current.split !== "custom" || split !== "custom") return [];
  return current.workouts.slice(Math.max(1, days)).map((workout) => workout.name);
}

/**
 * Saving these answers makes the workouts again from scratch, so edits by hand go. Your own plan keeps its own,
 * and so does a change to only the warm-up or cool-down (`answers` against `current`'s).
 */
export function remakes(current: (Pick<Plan, "split"> & Partial<Plan>) | null, split: Split, answers?: PlanAnswers): boolean {
  if (!current || (current.split === "custom" && split === "custom")) return false;
  return !(answers && current.workouts && onlyMobilityChanged(answersOf(current as Plan), answers));
}

/** Only the warm-up or cool-down differs: the server keeps the workouts and makes just those again. */
export function onlyMobilityChanged(current: PlanAnswers, next: PlanAnswers): boolean {
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && [...a].sort().every((item, index) => item === [...b].sort()[index]);
  return (current.warmUp !== next.warmUp || current.coolDown !== next.coolDown)
    && current.goal === next.goal && same(current.weekdays, next.weekdays) && current.minutes === next.minutes
    && current.experience === next.experience && same(current.equipment, next.equipment) && same(current.goEasy, next.goEasy)
    && easeInFor(current) === easeInFor(next) && (current.split ?? splitFor(current.weekdays.length, current.goal)) === (next.split ?? splitFor(next.weekdays.length, next.goal));
}

/** The setup's summary of what the answers make: a title and a line under it. */
export function previewSummary(preview: PlanPreview): { title: string; line: string } {
  const count = preview.workouts.length;
  if (preview.split === "custom") {
    return {
      title: `Your own, ${count} ${count === 1 ? "workout" : "workouts"} in turn`,
      line: "They start empty: after saving, tap each one on the Plan card to add exercises.",
    };
  }
  const exercises = Math.round(preview.workouts.reduce((sum, workout) => sum + workout.exercises.length, 0) / Math.max(1, count));
  const sets = Math.round(preview.workouts.reduce((sum, workout) => sum + setCount(workout), 0) / Math.max(1, count));
  return {
    title: `${splitLabel(preview.split)}, ${count} ${count === 1 ? "workout" : "workouts"} in turn`,
    line: `About ${exercises} exercises and ${sets} sets each · ${preview.blockWeeks}-week blocks, the last week lighter`,
  };
}

/** "3 × 6–10", "3 × 20", "3 × 45 s", "4 × 1 km" */
export function prescription(exercise: PlanExercise): string {
  if (exercise.seconds != null) return `${exercise.sets} × ${exercise.seconds} s`;
  if (exercise.metres != null) return `${exercise.sets} × ${distanceText(exercise.metres)}`;
  if (exercise.repMin != null && exercise.repMin === exercise.repMax) return `${exercise.sets} × ${exercise.repMin}`;
  if (exercise.repMin != null && exercise.repMax != null) return `${exercise.sets} × ${exercise.repMin}–${exercise.repMax}`;
  return `${exercise.sets} sets`;
}

/** What a plan workout asks of one exercise while it's logged: the range, the hold, the reps in reserve and the rest. */
export interface PlanTarget {
  repMin: number | null;
  repMax: number | null;
  seconds: number | null;
  /** A distance to cover each set. Missing on drafts from before it was added. */
  metres?: number | null;
  /** In a plan circuit: done on the clock, so no reps in reserve. */
  circuit?: boolean;
  rir: number;
  restSeconds: number;
  /** Ease in's first weeks: load suggestions take half steps. Missing on drafts from before it was added. */
  easing?: boolean;
}

/** The plan's next workout and where it sits in the block. */
export interface UpNext {
  workout: PlanWorkout;
  /** Its place in the sequence, from 0, as the session will store it. */
  position: number;
  /** The block, from 1. */
  block: number;
  /** The week in the block, from 1 to blockWeeks. */
  week: number;
  /** The reps to leave in reserve on working sets. */
  rir: number;
  /** The block's last week: half the sets, further from failure. */
  lighter: boolean;
  /** Ease in's first two weeks of the first block: further from failure, half load steps. */
  easing: boolean;
}

/**
 * Reps in reserve for a week of the block (docs/training.md, Rules): the working weeks step from 3 to 1
 * (3, 3, 2, 2, 1 in a 6-week block), and the last week is lighter at 4. Easing in, the plan's first two
 * weeks are 4, then 3.
 */
export function weekRir(week: number, blockWeeks: number, easing: boolean): number {
  if (week >= blockWeeks) return 4;
  if (easing && week <= 2) return week === 1 ? 4 : 3;
  const working = Math.max(1, blockWeeks - 1);
  return 3 - Math.floor(((week - 1) * 2) / Math.max(1, working - 1));
}

/**
 * The next workout: the one after the latest done or skipped, counting the finished ones still waiting to
 * send. A week of the block is as many plan workouts as days a week, so a missed day doesn't move it on.
 */
export function upNext(
  plan: Pick<Plan, "workouts" | "weekdays" | "blockWeeks" | "easeIn" | "lastPosition">,
  waiting: readonly { workoutId: string; position: number }[] = [],
): UpNext | null {
  if (!plan.workouts.length) return null;
  const ids = new Set(plan.workouts.map((item) => item.id));
  const last = Math.max(plan.lastPosition ?? -1, ...waiting.filter((item) => ids.has(item.workoutId)).map((item) => item.position));
  const position = last + 1;
  const weeks = Math.floor(position / Math.max(1, plan.weekdays.length));
  const blockWeeks = Math.max(1, plan.blockWeeks);
  const block = Math.floor(weeks / blockWeeks) + 1;
  const week = (weeks % blockWeeks) + 1;
  return {
    workout: plan.workouts[position % plan.workouts.length],
    position,
    block,
    week,
    rir: weekRir(week, blockWeeks, plan.easeIn && block === 1),
    lighter: week === blockWeeks,
    easing: plan.easeIn && block === 1 && week <= 2 && week < blockWeeks,
  };
}

/** A lighter week does half the working sets, at least one. */
export function weekSets(exercise: PlanExercise, lighter: boolean): number {
  return lighter ? Math.max(1, Math.ceil(exercise.sets / 2)) : exercise.sets;
}

/** "Week 2 of 6 · 3 reps in reserve", "Week 6 of 6 · lighter week". */
export function weekLine(next: Pick<UpNext, "week" | "rir" | "lighter"> & { workout?: PlanWorkout }, blockWeeks: number): string {
  if (next.lighter) return `Week ${next.week} of ${blockWeeks} · lighter week`;
  // A circuit on the clock or run intervals go by time, not reps in reserve.
  if (next.workout && conditioning(next.workout)) return `Week ${next.week} of ${blockWeeks}`;
  return `Week ${next.week} of ${blockWeeks} · ${next.rir} ${next.rir === 1 ? "rep" : "reps"} in reserve`;
}

/** A Hyrox conditioning workout: a circuit done for time, or only distances (run intervals). */
export function conditioning(workout: PlanWorkout): boolean {
  return workout.exercises.length > 0
    && (workout.exercises.some((item) => item.format === "for_time") || workout.exercises.every((item) => item.metres != null));
}

/** "EMOM 10 min", "AMRAP 8 min", "For time": a plan circuit's clock. */
export function clockLabel(exercise: Pick<PlanExercise, "format" | "minutes">): string {
  if (exercise.format === "emom") return `EMOM ${exercise.minutes ?? 10} min`;
  if (exercise.format === "amrap") return `AMRAP ${exercise.minutes ?? 12} min`;
  return exercise.format === "for_time" ? "For time" : "";
}

/** A finisher: the EMOM or AMRAP block at the end of a kettlebell plan's workout (README → Kettlebell plans). */
export function finisherOf(workout: PlanWorkout): { at: number; label: string } | null {
  const at = workout.exercises.findIndex((item) => item.format === "emom" || item.format === "amrap");
  return at > 0 ? { at, label: clockLabel(workout.exercises[at]) } : null;
}

/** "5 exercises · 8 sets · ~30 min" for the week: a lighter week counts its halved sets and not its time. */
export function nextLine(next: UpNext): string {
  if (!next.lighter || !next.workout.exercises.length) return workoutLine(next.workout);
  const count = next.workout.exercises.length;
  const sets = next.workout.exercises.reduce((sum, exercise) => sum + weekSets(exercise, true), 0);
  return `${count} ${count === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"}`;
}

/** An exercise's target for this session. */
export function targetOf(exercise: PlanExercise, next: Pick<UpNext, "rir"> & Partial<Pick<UpNext, "easing">>): PlanTarget {
  return {
    repMin: exercise.repMin, repMax: exercise.repMax, seconds: exercise.seconds, metres: exercise.metres ?? null,
    rir: next.rir, restSeconds: exercise.restSeconds, easing: next.easing ?? false,
    ...(exercise.superset || exercise.format ? { circuit: true } : {}),
  };
}

/**
 * "6–10 reps · 2 in reserve", "45 s hold", "1 km". The line over a plan exercise's set table.
 * A warm-up move keeps going rather than holding, so it's just "30 s".
 */
export function targetLine(target: PlanTarget, moving = false): string {
  if (target.seconds != null) return moving ? `${target.seconds} s` : `${target.seconds} s hold`;
  if (target.metres != null) return distanceText(target.metres);
  const reps = target.repMin != null && target.repMax != null
    ? target.repMin === target.repMax ? `${target.repMin} reps` : `${target.repMin}–${target.repMax} reps`
    : "";
  return [reps, target.circuit ? "" : `${target.rir} in reserve`].filter(Boolean).join(" · ");
}

/** A coming plan workout on a projected day. */
export interface PlannedDay {
  date: string;
  workout: PlanWorkout;
  position: number;
}

/** 0 = Monday, as the plan's weekdays. */
export function weekdayOf(date: string): number {
  return (parse(date).getDay() + 6) % 7;
}

/**
 * The coming plan workouts on your training days (docs/training.md, decision 2). The days only project
 * dates: Up next goes on the first training day from today, or from tomorrow once a plan workout is done
 * or skipped today, and the ones after it on the training days that follow. Training off-pattern moves
 * the projection, never the sequence.
 */
export function projectDays(
  plan: Pick<Plan, "workouts" | "weekdays">,
  next: Pick<UpNext, "position">,
  today: string,
  doneToday: boolean,
  count: number,
): PlannedDay[] {
  if (!plan.workouts.length || !plan.weekdays.length) return [];
  const days: PlannedDay[] = [];
  let date = doneToday ? addDays(today, 1) : today;
  for (let guard = 0; days.length < count && guard < 7 * (count + 1); guard++, date = addDays(date, 1)) {
    if (!plan.weekdays.includes(weekdayOf(date))) continue;
    const position = next.position + days.length;
    days.push({ date, workout: plan.workouts[position % plan.workouts.length], position });
  }
  return days;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** "Today", "Tomorrow", "Mon 30 Nov". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return DAY_FORMAT.format(parse(date));
}

// A new plan before it starts (README → The plan on Train): its week, each workout's days and what to expect.

/** The days each workout falls on in a week: the training days in order take the workouts in turn. */
export function workoutDays(weekdays: readonly number[], count: number): number[][] {
  const days: number[][] = Array.from({ length: count }, () => []);
  if (!count) return days;
  [...weekdays].sort((a, b) => a - b).forEach((day, at) => days[at % count].push(day));
  return days;
}

/** "Mon, Thu" */
export function dayNames(days: readonly number[]): string {
  return days.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ");
}

/** The workouts' time to the nearest 5, or the time asked for while they're empty (your own). */
export function eachMinutes(workouts: readonly Pick<PlanWorkout, "minutes" | "exercises">[], asked: number): number {
  const timed = workouts.filter((workout) => workout.exercises.length);
  if (!timed.length) return asked;
  return Math.round(timed.reduce((sum, workout) => sum + workout.minutes, 0) / timed.length / 5) * 5;
}

/** How the block runs, in a line. */
export function blockNote(preview: Pick<PlanPreview, "split" | "easeIn" | "blockWeeks">): string {
  if (preview.split === "custom") return "The workouts start empty. Once the plan starts, tap each one under Your plan to add exercises.";
  const build = `Each week adds a little, then week ${preview.blockWeeks} is lighter so you recover.`;
  return preview.easeIn ? `The first 2 weeks ease in. ${build}` : build;
}

/** The kinds of plan Explore → Plans shows: the splits the days pick, Hyrox, and your own. */
export interface PlanKind {
  split: Split;
  /** Days a week it's made for, the least and the most. */
  minDays: number;
  maxDays: number;
  /** "1–3 days" */
  days: string;
  line: string;
  goals: string;
  /** The days its sample week uses when yours don't fit it. */
  sample: number[];
}

export const PLAN_KINDS: PlanKind[] = [
  { split: "full_body", minDays: 1, maxDays: 3, days: "1–3 days", line: "Every muscle each time, A and B in turn", goals: "Muscle · Strength · Fitness", sample: [0, 2, 4] },
  { split: "upper_lower", minDays: 4, maxDays: 4, days: "4 days", line: "Two upper days and two lower days", goals: "Muscle · Strength · Fitness", sample: [0, 1, 3, 4] },
  { split: "ppl_upper_lower", minDays: 5, maxDays: 5, days: "5 days", line: "Push, pull and legs, then upper and lower", goals: "Muscle · Strength · Fitness", sample: [0, 1, 2, 4, 5] },
  { split: "push_pull_legs", minDays: 6, maxDays: 7, days: "6–7 days", line: "Each muscle twice a week", goals: "Muscle · Strength · Fitness", sample: [0, 1, 2, 3, 4, 5] },
  { split: "hyrox", minDays: 1, maxDays: 7, days: "Any days", line: "Strength, the race's stations and runs", goals: "Hyrox", sample: [0, 2, 4] },
  { split: "custom", minDays: 1, maxDays: 7, days: "Any days", line: "Empty workouts you fill and name", goals: "Any goal", sample: [0, 2, 4] },
];

/** Your days when there are as many as the kind is made for, else its sample week. */
export function kindDays(kind: PlanKind, weekdays: number[]): number[] {
  return weekdays.length >= kind.minDays && weekdays.length <= kind.maxDays ? [...weekdays].sort((a, b) => a - b) : [...kind.sample];
}

/** Hyrox takes its own goal; the others keep yours, or Muscle when yours is Hyrox. */
export function kindGoal(kind: PlanKind, goal: PlanGoal): PlanGoal {
  if (kind.split === "hyrox") return "hyrox";
  if (kind.split === "custom") return goal;
  return goal === "hyrox" ? "muscle" : goal;
}
