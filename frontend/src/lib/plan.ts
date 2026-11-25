// Training plans (docs/training.md, phase 3; README → Training plans). The server makes the workouts;
// this file holds the setup's choices, their labels and the lines the app shows.

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
