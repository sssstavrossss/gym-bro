// A workout being logged, as pure data and rules (docs/training.md, phase 2). The state module keeps it
// on the phone while it runs; the API stores it whole when it finishes (README → Workouts).
import type { ExerciseItem, ExerciseMeasure } from "./exercises";

export type SetType = "warmup" | "working" | "drop";
export type SetField = "kg" | "reps" | "rir" | "seconds" | "metres";

export interface WorkoutSetValues {
  kg: number | null;
  reps: number | null;
  rir: number | null;
  seconds: number | null;
  metres: number | null;
}

export interface DraftSet extends WorkoutSetValues {
  type: SetType;
  /** ISO time it was ticked off, or null while it isn't. */
  doneAt: string | null;
}

export interface DraftExercise {
  /** Stable within the workout, so the same exercise can appear twice. */
  key: string;
  exerciseId: string;
  sets: DraftSet[];
}

export interface DraftWorkout {
  /** The app's own id, sent with PUT /api/workouts/{id}. */
  id: string;
  date: string;
  startedAt: string;
  endedAt: string | null;
  name: string | null;
  exercises: DraftExercise[];
  /** When the rest timer runs out (ISO), and how long it was set for, in seconds. */
  restEndsAt: string | null;
  restFor: number;
}

/** A set as the API sends it back (`GET /api/workouts/previous`). */
export interface SavedSet extends WorkoutSetValues {
  exerciseId: string;
  block: number;
  type: SetType;
  calories: number | null;
  doneAt: string | null;
}

export interface WorkoutRequestBody {
  date: string;
  timeZone: string;
  kind: "strength";
  name: string | null;
  status: "done";
  startedAt: string;
  endedAt: string | null;
  sets: (WorkoutSetValues & { exerciseId: string; block: number; type: SetType; calories: null; doneAt: string | null })[];
}

/** The fields a set records for each measure, in the order they are typed. */
export function measureFields(measure: ExerciseMeasure): SetField[] {
  switch (measure) {
    case "weight_reps": return ["kg", "reps", "rir"];
    case "reps": return ["reps", "rir"];
    case "time": return ["seconds"];
    case "distance_time": return ["metres", "seconds"];
    case "weight_distance": return ["kg", "metres"];
  }
}

export const FIELD_LABELS: Record<SetField, string> = { kg: "kg", reps: "Reps", rir: "RIR", seconds: "Time", metres: "m" };

/** Whole numbers only, apart from kg (to 0.25 on the keypad: any 2 decimals) and metres. */
export function fieldDecimals(field: SetField): number {
  return field === "kg" ? 2 : field === "metres" ? 1 : 0;
}

const LIMITS: Record<SetField, number> = { kg: 1000, reps: 1000, rir: 10, seconds: 86_400, metres: 1_000_000 };

export function emptySet(type: SetType = "working"): DraftSet {
  return { type, kg: null, reps: null, rir: null, seconds: null, metres: null, doneAt: null };
}

/**
 * Grey hints for a set that hasn't been typed in: this workout's set before it when that one is done,
 * else the same set last time, else last time's final set. Ticking a set takes its hints as values.
 */
export function setHints(exercise: DraftExercise, index: number, lastTime: readonly SavedSet[]): WorkoutSetValues {
  const before = exercise.sets[index - 1];
  const source: WorkoutSetValues | undefined = before?.doneAt
    ? before
    : lastTime.filter((set) => set.type !== "warmup")[index - warmupsBefore(exercise, index)] ?? lastTime[lastTime.length - 1];
  return {
    kg: source?.kg ?? null,
    reps: source?.reps ?? null,
    rir: source?.rir ?? null,
    seconds: source?.seconds ?? null,
    metres: source?.metres ?? null,
  };
}

function warmupsBefore(exercise: DraftExercise, index: number): number {
  return exercise.sets.slice(0, index).filter((set) => set.type === "warmup").length;
}

/** Ticks a set off: empty fields take their hints. Ticking again undoes it and keeps what was typed. */
export function toggleSet(set: DraftSet, hints: WorkoutSetValues, fields: readonly SetField[], now: Date): DraftSet {
  if (set.doneAt) return { ...set, doneAt: null };
  const filled = { ...set, doneAt: now.toISOString() };
  for (const field of fields) if (filled[field] == null) filled[field] = hints[field];
  return filled;
}

/** A set that counts toward totals: ticked off, not a warm-up. Same rule as the API. */
export function setCounts(set: DraftSet): boolean {
  return set.doneAt != null && set.type !== "warmup";
}

export function workoutTotals(workout: DraftWorkout): { sets: number; plannedSets: number; volumeKg: number } {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  const counted = sets.filter(setCounts);
  return {
    sets: counted.length,
    plannedSets: sets.filter((set) => set.type !== "warmup").length,
    volumeKg: Math.round(counted.reduce((sum, set) => sum + (set.kg ?? 0) * (set.reps ?? 0), 0) * 100) / 100,
  };
}

/** Sets not ticked off, which Finish leaves out. */
export function undoneSets(workout: DraftWorkout): number {
  return workout.exercises.reduce((count, exercise) => count + exercise.sets.filter((set) => !set.doneAt).length, 0);
}

/**
 * Rest after a set, in seconds. Heavy leg and hip compounds 3:00, other compounds 2:00, isolation 1:30,
 * none after cardio, stretches and timed holds (docs/training.md research notes).
 */
export function restSeconds(item: Pick<ExerciseItem, "category" | "mechanic" | "measure" | "primaryMuscles">): number {
  if (item.category === "cardio" || item.category === "stretching" || item.measure === "time" || item.measure === "distance_time") return 0;
  if (item.mechanic === "compound") {
    const lower = item.primaryMuscles.some((muscle) => ["quadriceps", "hamstrings", "glutes", "lower-back"].includes(muscle));
    return lower ? 180 : 120;
  }
  return 90;
}

/** Seconds left on the rest timer, never below 0, or null when none is running. */
export function restLeft(workout: Pick<DraftWorkout, "restEndsAt">, now: number): number | null {
  if (!workout.restEndsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(workout.restEndsAt) - now) / 1000));
}

/** "1:05", "12:40", "1:02:03". */
export function clock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** One set in words, for "last time" and the done summary: "80 × 8", "12 reps", "1:30", "500 m · 2:10", "40 kg · 20 m". */
export function formatSet(set: WorkoutSetValues, measure: ExerciseMeasure): string {
  switch (measure) {
    case "weight_reps":
      if (set.kg == null) return set.reps == null ? "—" : `${set.reps} reps`;
      return `${number(set.kg)} × ${set.reps ?? "—"}`;
    case "reps":
      return set.reps == null ? "—" : `${set.reps} reps`;
    case "time":
      return set.seconds == null ? "—" : clock(set.seconds);
    case "distance_time":
      return [set.metres != null ? `${number(set.metres)} m` : null, set.seconds != null ? clock(set.seconds) : null].filter(Boolean).join(" · ") || "—";
    case "weight_distance":
      return [set.kg != null ? `${number(set.kg)} kg` : null, set.metres != null ? `${number(set.metres)} m` : null].filter(Boolean).join(" · ") || "—";
  }
}

/** A field's value as the cell shows it. Time shows as m:ss. */
export function fieldText(field: SetField, value: number | null): string {
  if (value == null) return "";
  return field === "seconds" ? clock(value) : number(value);
}

/**
 * What the keypad typed, as a number for the field, or null when it is empty or not a number. Time is typed
 * as digits read from the right (130 → 1:30), like a microwave. Values past the API's limits are refused.
 */
export function parseField(field: SetField, text: string): number | null | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  if (field === "seconds") {
    if (!/^\d{1,6}$/.test(trimmed)) return undefined;
    const digits = trimmed.padStart(6, "0");
    const value = Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60 + Number(digits.slice(4));
    return value <= LIMITS.seconds ? value : undefined;
  }
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  const places = fieldDecimals(field);
  if (!places && !Number.isInteger(value)) return undefined;
  if (value > LIMITS[field]) return undefined;
  return Math.round(value * 10 ** places) / 10 ** places;
}

/** The digits the keypad edits for a stored time: 90 s → "130". */
export function secondsDigits(value: number | null): string {
  if (value == null) return "";
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const ss = String(value % 60).padStart(2, "0");
  if (h) return `${h}${String(m).padStart(2, "0")}${ss}`;
  return m ? `${m}${ss}` : String(value % 60);
}

/** One key on the app keypad, applied to the text being typed. */
export function typeKey(text: string, key: string, field: SetField): string {
  if (key === "⌫") return text.slice(0, -1);
  if (key === ".") return fieldDecimals(field) && !text.includes(".") ? (text || "0") + "." : text;
  const next = text === "0" ? key : text + key;
  return parseField(field, next) === undefined ? text : next;
}

/** The whole workout as `PUT /api/workouts/{id}` takes it. Each exercise is its own block. */
export function toRequest(workout: DraftWorkout, timeZone: string): WorkoutRequestBody {
  return {
    date: workout.date,
    timeZone,
    kind: "strength",
    name: workout.name,
    status: "done",
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    sets: workout.exercises.flatMap((exercise, block) => exercise.sets.map((set) => ({
      exerciseId: exercise.exerciseId,
      block,
      type: set.type,
      kg: set.kg,
      reps: set.reps,
      rir: set.rir,
      seconds: set.seconds,
      metres: set.metres,
      calories: null,
      doneAt: set.doneAt,
    }))),
  };
}

/** Drops sets that weren't ticked off, then exercises left with none. What Finish saves. */
export function finished(workout: DraftWorkout, now: Date): DraftWorkout {
  return {
    ...workout,
    endedAt: now.toISOString(),
    restEndsAt: null,
    exercises: workout.exercises
      .map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.doneAt) }))
      .filter((exercise) => exercise.sets.length),
  };
}

/** The exercise to show open: the first with a set not done, else the last one. */
export function currentExercise(workout: DraftWorkout): string | null {
  const open = workout.exercises.find((exercise) => exercise.sets.some((set) => !set.doneAt));
  return (open ?? workout.exercises[workout.exercises.length - 1])?.key ?? null;
}

/**
 * An exercise's done sets in one line, for its folded row and the summary: "80 kg × 10, 10, 9" when the
 * weight held, else each set ("80 × 10, 82.5 × 8"). Warm-ups are left out. Empty when nothing is done.
 */
export function exerciseSummary(sets: readonly DraftSet[], measure: ExerciseMeasure): string {
  const done = sets.filter(setCounts);
  if (!done.length) return "";
  const kg = done[0].kg;
  if (measure === "weight_reps" && kg != null && done.every((set) => set.kg === kg && set.reps != null)) {
    return `${number(kg)} kg × ${done.map((set) => set.reps).join(", ")}`;
  }
  return done.map((set) => formatSet(set, measure)).join(", ");
}


/** "12:40 · 4 of 16 sets": how long it has run and the sets ticked off, for the sheet and the Train card. */
export function workoutStatus(workout: DraftWorkout, now: number): string {
  const totals = workoutTotals(workout);
  return `${clock((now - Date.parse(workout.startedAt)) / 1000)} · ${totals.sets} of ${totals.plannedSets} ${totals.plannedSets === 1 ? "set" : "sets"}`;
}
