// Editing a plan workout by hand (docs/training.md, phase 5; README → Edit a plan workout). The server checks the
// same limits (Training/PlanEdits.cs) and works out the minutes again; this file keeps the editor in them.
import type { ExerciseItem } from "./exercises";
import type { Plan, PlanExercise } from "./plan";
import { clock, restSeconds } from "./workout";

export const MAX_EXERCISES = 15;
export const MAX_NAME = 30;
export const MAX_SETS = 10;
export const MAX_REPS = 50;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600;
export const MAX_REST = 600;
/** Holds and rest step by 15 seconds. */
export const TIME_STEP = 15;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** How an exercise is prescribed: a rep range for lifts, seconds for holds, neither for cardio and carries. */
export function prescribedBy(measure: ExerciseItem["measure"]): "reps" | "seconds" | "none" {
  return measure === "weight_reps" || measure === "reps" ? "reps" : measure === "time" ? "seconds" : "none";
}

/**
 * An exercise added by hand gets what the generator would give it: sets by experience, the goal's rep range for a
 * compound or isolation move, a hold by experience, and the usual rest (a third less for fitness).
 */
export function defaultPrescription(item: ExerciseItem, plan: Pick<Plan, "goal" | "experience" | "minutes">): PlanExercise {
  const compound = item.mechanic === "compound";
  let sets = compound ? (plan.experience === "experienced" ? 4 : 3) : plan.experience === "new" ? 2 : 3;
  if (plan.minutes <= 20) sets = Math.min(sets, 2);
  let rest = restSeconds(item);
  if (plan.goal === "fitness") rest = Math.round((rest * 2) / 3 / 15) * 15;
  const by = prescribedBy(item.measure);
  if (by === "seconds") {
    const hold = plan.experience === "new" ? 30 : plan.experience === "experienced" ? 60 : 45;
    return { exerciseId: item.id, sets, repMin: null, repMax: null, seconds: hold, restSeconds: 60 };
  }
  if (by === "none") return { exerciseId: item.id, sets: 1, repMin: null, repMax: null, seconds: null, restSeconds: rest };
  const [repMin, repMax] = item.measure === "reps"
    ? compound ? [8, 15] : [10, 20]
    : plan.goal === "strength" ? compound ? [6, 8] : [8, 12]
    : plan.goal === "fitness" ? compound ? [8, 12] : [12, 15]
    : compound ? [6, 10] : [10, 15];
  return { exerciseId: item.id, sets, repMin, repMax, seconds: null, restSeconds: rest };
}

export function stepSets(exercise: PlanExercise, by: number): PlanExercise {
  return { ...exercise, sets: clamp(exercise.sets + by, 1, MAX_SETS) };
}

/** Moves one end of the rep range, pushing the other along so the low end never passes the high end. */
export function stepReps(exercise: PlanExercise, end: "low" | "high", by: number): PlanExercise {
  let low = exercise.repMin ?? 8;
  let high = exercise.repMax ?? 12;
  if (end === "low") {
    low = clamp(low + by, 1, MAX_REPS);
    high = Math.max(high, low);
  } else {
    high = clamp(high + by, 1, MAX_REPS);
    low = Math.min(low, high);
  }
  return { ...exercise, repMin: low, repMax: high };
}

export function stepSeconds(exercise: PlanExercise, by: number): PlanExercise {
  const now = exercise.seconds ?? 30;
  // Off-grid values (a hold of 5 or 50) land on the 15-second grid on the first step.
  const next = by > 0 ? Math.floor(now / TIME_STEP) * TIME_STEP + TIME_STEP : Math.ceil(now / TIME_STEP) * TIME_STEP - TIME_STEP;
  return { ...exercise, seconds: clamp(next, MIN_SECONDS, MAX_SECONDS) };
}

export function stepRest(exercise: PlanExercise, by: number): PlanExercise {
  const now = exercise.restSeconds;
  const next = by > 0 ? Math.floor(now / TIME_STEP) * TIME_STEP + TIME_STEP : Math.ceil(now / TIME_STEP) * TIME_STEP - TIME_STEP;
  return { ...exercise, restSeconds: clamp(next, 0, MAX_REST) };
}

/** The list with one exercise moved up (-1) or down (+1); the same list at either end. */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** The server's estimate (PlanGenerator.Minutes): the warm-up, then each exercise's sets, rest and changeover. */
export function estimateMinutes(exercises: readonly PlanExercise[], planMinutes: number): number {
  const warmUp = planMinutes <= 20 ? 120 : 300;
  const seconds = exercises.reduce((sum, item) => sum + item.sets * ((item.seconds ?? 40) + item.restSeconds) + 60, warmUp);
  return Math.max(5, Math.round(seconds / 300) * 5);
}

/** "Rest 2:00", or "No rest". */
export function restLine(seconds: number): string {
  return seconds ? `Rest ${clock(seconds)}` : "No rest";
}

/** Same exercises, order and numbers as when the editor opened. */
export function sameExercises(a: readonly PlanExercise[], b: readonly PlanExercise[]): boolean {
  return a.length === b.length && a.every((item, index) => {
    const other = b[index];
    return item.exerciseId === other.exerciseId && item.sets === other.sets && item.repMin === other.repMin
      && item.repMax === other.repMax && item.seconds === other.seconds && item.restSeconds === other.restSeconds;
  });
}
