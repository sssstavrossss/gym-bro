// Training plans (docs/training.md, phase 3; README → Training plans). The server makes the workouts;
// this file holds the setup's choices, their labels and the lines the app shows.
import { addDays, parse } from "./dates";

export type PlanGoal = "muscle" | "strength" | "fitness";
export type Experience = "new" | "some" | "experienced";
export type EquipmentPreset = "gym" | "home" | "dumbbells" | "kettlebells" | "bodyweight";
export type Joint = "shoulders" | "elbows" | "wrists" | "lower-back" | "hips" | "knees" | "ankles";
export type Split = "full_body" | "upper_lower" | "push_pull_legs" | "ppl_upper_lower";

export interface PlanExercise {
  exerciseId: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  /** A hold's target, in seconds, instead of reps. */
  seconds: number | null;
  restSeconds: number;
}

export interface PlanWorkout {
  id: string;
  name: string;
  /** The estimate, to the nearest 5. */
  minutes: number;
  exercises: PlanExercise[];
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
  blockWeeks: number;
  startDate: string;
  updatedAt: string;
  workouts: PlanWorkout[];
  /** The highest place in the sequence done or skipped from this plan's workouts, or null before the first. */
  lastPosition: number | null;
}

export interface PlanPreview {
  split: Split;
  easeIn: boolean;
  blockWeeks: number;
  workouts: PlanWorkout[];
}

export const GOALS: { value: PlanGoal; label: string }[] = [
  { value: "muscle", label: "Muscle" },
  { value: "strength", label: "Strength" },
  { value: "fitness", label: "Fitness" },
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
];

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const MIN_MINUTES = 10;
export const MAX_MINUTES = 120;
export const MINUTE_STEP = 5;

export function defaultAnswers(): PlanAnswers {
  return { goal: "muscle", weekdays: [0, 2, 4], minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], easeIn: null, split: null };
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
  };
}

/** The split that follows from the days a week, as the server picks it. */
export function splitFor(days: number): Split {
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

/** "6 exercises · 16 sets · ~55 min" */
export function workoutLine(workout: PlanWorkout): string {
  const count = workout.exercises.length;
  const sets = setCount(workout);
  return `${count} ${count === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"} · ~${workout.minutes} min`;
}

/** "Muscle · Upper / Lower · 4 days · 60 min" */
export function planLine(plan: Pick<Plan, "goal" | "split" | "weekdays" | "minutes">): string {
  const days = plan.weekdays.length;
  return `${goalLabel(plan.goal)} · ${splitLabel(plan.split)} · ${days} ${days === 1 ? "day" : "days"} · ${plan.minutes} min`;
}

/** The setup's summary of what the answers make: a title and a line under it. */
export function previewSummary(preview: PlanPreview): { title: string; line: string } {
  const count = preview.workouts.length;
  const exercises = Math.round(preview.workouts.reduce((sum, workout) => sum + workout.exercises.length, 0) / Math.max(1, count));
  const sets = Math.round(preview.workouts.reduce((sum, workout) => sum + setCount(workout), 0) / Math.max(1, count));
  return {
    title: `${splitLabel(preview.split)}, ${count} ${count === 1 ? "workout" : "workouts"} in turn`,
    line: `About ${exercises} exercises and ${sets} sets each · ${preview.blockWeeks}-week blocks, the last week lighter`,
  };
}

/** "3 × 6–10", "3 × 45 s" */
export function prescription(exercise: PlanExercise): string {
  if (exercise.seconds != null) return `${exercise.sets} × ${exercise.seconds} s`;
  if (exercise.repMin != null && exercise.repMax != null) return `${exercise.sets} × ${exercise.repMin}–${exercise.repMax}`;
  return `${exercise.sets} sets`;
}

/** What a plan workout asks of one exercise while it's logged: the range, the hold, the reps in reserve and the rest. */
export interface PlanTarget {
  repMin: number | null;
  repMax: number | null;
  seconds: number | null;
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
export function weekLine(next: Pick<UpNext, "week" | "rir" | "lighter">, blockWeeks: number): string {
  const tail = next.lighter ? "lighter week" : `${next.rir} ${next.rir === 1 ? "rep" : "reps"} in reserve`;
  return `Week ${next.week} of ${blockWeeks} · ${tail}`;
}

/** "5 exercises · 8 sets · ~30 min" for the week: a lighter week counts its halved sets and not its time. */
export function nextLine(next: UpNext): string {
  if (!next.lighter) return workoutLine(next.workout);
  const count = next.workout.exercises.length;
  const sets = next.workout.exercises.reduce((sum, exercise) => sum + weekSets(exercise, true), 0);
  return `${count} ${count === 1 ? "exercise" : "exercises"} · ${sets} ${sets === 1 ? "set" : "sets"}`;
}

/** An exercise's target for this session. */
export function targetOf(exercise: PlanExercise, next: Pick<UpNext, "rir"> & Partial<Pick<UpNext, "easing">>): PlanTarget {
  return { repMin: exercise.repMin, repMax: exercise.repMax, seconds: exercise.seconds, rir: next.rir, restSeconds: exercise.restSeconds, easing: next.easing ?? false };
}

/** "6–10 reps · 2 in reserve", "45 s hold". The line over a plan exercise's set table. */
export function targetLine(target: PlanTarget): string {
  if (target.seconds != null) return `${target.seconds} s hold`;
  const reps = target.repMin != null && target.repMax != null ? `${target.repMin}–${target.repMax} reps` : "";
  return [reps, `${target.rir} in reserve`].filter(Boolean).join(" · ");
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
