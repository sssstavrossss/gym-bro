// A workout being logged, as pure data and rules (docs/training.md, phase 2). The state module keeps it
// on the phone while it runs; the API stores it whole when it finishes (README → Workouts).
import { parse } from "./dates";
import { cardioSet, distanceText, paceUnit } from "./cardio";
import type { ExerciseItem, ExerciseMeasure } from "./exercises";
import type { PlanTarget } from "./plan";
import type { LoadSuggestion } from "./progression";
import { fromBlockBody, stopped, toBlockBody, type TimedBlockBody, type TimedState } from "./timed";

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
  /** From a plan workout: the range, reps in reserve and rest to aim for. */
  target?: PlanTarget | null;
  /** Done together with the exercise before it (a superset, or a circuit of three or more): rest comes after each round. */
  superset?: boolean;
  /** On the first exercise of a run done on the clock: its format, clock and score (lib/timed.ts). */
  timed?: TimedState | null;
  /** From a plan with a warm-up or cool-down: which one it's in. The plan's own exercises have none. */
  part?: WorkoutPart | null;
}

export type WorkoutPart = "warmup" | "cooldown";

export interface DraftWorkout {
  /** The app's own id, sent with PUT /api/workouts/{id}. */
  id: string;
  date: string;
  /** Null for a workout logged afterwards without times. */
  startedAt: string | null;
  endedAt: string | null;
  name: string | null;
  exercises: DraftExercise[];
  /** When the rest timer runs out (ISO), and how long it was set for, in seconds. */
  restEndsAt: string | null;
  restFor: number;
  /** The plan workout it's done from, and its place in the sequence. Missing for a free workout. */
  plan?: { workoutId: string; position: number } | null;
  /** Saved as skipped. Adding sets to it and saving makes it done. */
  skipped?: boolean;
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
  /** Left to the server, which takes it from the exercises (cardio, hybrid, strength). */
  kind: null;
  name: string | null;
  status: "done" | "skipped";
  startedAt: string | null;
  endedAt: string | null;
  planWorkoutId: string | null;
  sequencePosition: number | null;
  sets: (WorkoutSetValues & { exerciseId: string; block: number; type: SetType; calories: null; doneAt: string | null })[];
  blocks: TimedBlockBody[];
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
 * else the same set last time, else last time's final set, with the suggested weight and reps on working sets.
 * Ticking a set takes its hints as values.
 */
export function setHints(
  exercise: DraftExercise,
  index: number,
  lastTime: readonly SavedSet[],
  suggestion?: Pick<LoadSuggestion, "kg" | "reps"> | null,
): WorkoutSetValues {
  const before = exercise.sets[index - 1];
  // A warm-up done before it doesn't set a working set's weight.
  const fromBefore = !!before?.doneAt && (before.type !== "warmup" || exercise.sets[index]?.type === "warmup");
  const source: WorkoutSetValues | undefined = fromBefore
    ? before
    : lastTime.filter((set) => set.type !== "warmup")[index - warmupsBefore(exercise, index)] ?? lastTime[lastTime.length - 1];
  // A working set not following one done today takes the suggested weight, and the reps to aim for.
  const suggested = !fromBefore && suggestion && exercise.sets[index]?.type === "working" ? suggestion : null;
  // A plan's target sets this week's reps in reserve, a hold's time until there is a last time, a set number of reps
  // (20 wall balls) the same way, and the distance to cover.
  const fixed = exercise.target?.repMin != null && exercise.target.repMin === exercise.target.repMax ? exercise.target.repMin : null;
  return {
    kg: suggested?.kg ?? source?.kg ?? null,
    reps: suggested?.reps ?? source?.reps ?? fixed,
    rir: exercise.target?.circuit ? null : exercise.target?.rir ?? source?.rir ?? null,
    seconds: source?.seconds ?? exercise.target?.seconds ?? null,
    metres: exercise.target?.metres ?? source?.metres ?? null,
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

/** Sets that count, the sets planned, kg × reps, and the distance covered (metres of sets with no weight: a run, not a sled push). */
export function workoutTotals(workout: DraftWorkout): { sets: number; plannedSets: number; volumeKg: number; metres: number } {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  const counted = sets.filter(setCounts);
  return {
    sets: counted.length,
    plannedSets: sets.filter((set) => set.type !== "warmup").length,
    volumeKg: Math.round(counted.reduce((sum, set) => sum + (set.kg ?? 0) * (set.reps ?? 0), 0) * 100) / 100,
    metres: Math.round(counted.reduce((sum, set) => sum + (set.kg == null ? set.metres ?? 0 : 0), 0) * 10) / 10,
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

/**
 * One set in words, for "last time" and the done summary: "80 × 8", "12 reps", "1:30", "40 kg · 20 m", and with the
 * exercise's id a cardio set gets its pace, "5 km · 25:00 · 5:00 /km" (lib/cardio.ts).
 */
export function formatSet(set: WorkoutSetValues, measure: ExerciseMeasure, exerciseId?: string): string {
  switch (measure) {
    case "weight_reps":
      if (set.kg == null) return set.reps == null ? "—" : `${set.reps} reps`;
      return `${number(set.kg)} × ${set.reps ?? "—"}`;
    case "reps":
      return set.reps == null ? "—" : `${set.reps} reps`;
    case "time":
      return set.seconds == null ? "—" : clock(set.seconds);
    case "distance_time":
      return cardioSet(set, exerciseId ? paceUnit(exerciseId) : null);
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

/** The whole workout as `PUT /api/workouts/{id}` takes it. Each exercise is its own block, except that a superset shares one. */
export function toRequest(workout: DraftWorkout, timeZone: string): WorkoutRequestBody {
  let block = -1;
  const blocks = exerciseGroups(workout.exercises).flatMap((run, index) => (run[0].timed ? [toBlockBody(run[0].timed, run, index)] : []));
  return {
    date: workout.date,
    timeZone,
    kind: null,
    name: workout.name,
    status: workout.skipped && !workout.exercises.some((exercise) => exercise.sets.length) ? "skipped" : "done",
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    planWorkoutId: workout.plan?.workoutId ?? null,
    sequencePosition: workout.plan?.position ?? null,
    sets: workout.exercises.flatMap((exercise, at) => {
      if (at === 0 || !exercise.superset) block++;
      return exercise.sets.map((set) => ({
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
    }));
    }),
    blocks,
  };
}

/**
 * Drops sets that weren't ticked off, then exercises left with none. What a save keeps. A superset stays one: when
 * its first exercise goes, the next one left leads it and keeps its clock.
 */
export function dropUndone(workout: DraftWorkout): DraftWorkout {
  return {
    ...workout,
    restEndsAt: null,
    exercises: exerciseGroups(workout.exercises).flatMap((run) => {
      const kept = run
        .map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.doneAt) }))
        .filter((exercise) => exercise.sets.length);
      return kept.map((exercise, index) => {
        const { superset: _joined, timed: _timed, ...rest } = exercise;
        if (index > 0) return { ...rest, superset: true };
        return run[0].timed ? { ...rest, timed: run[0].timed } : rest;
      });
    }),
  };
}

/** What Finish saves: the ticked sets, ending now, with any clock still running stopped. */
export function finished(workout: DraftWorkout, now: Date): DraftWorkout {
  const exercises = workout.exercises.map((exercise) => (exercise.timed ? { ...exercise, timed: stopped(exercise.timed, now) } : exercise));
  return { ...dropUndone({ ...workout, exercises }), endedAt: now.toISOString() };
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
export function exerciseSummary(sets: readonly DraftSet[], measure: ExerciseMeasure, exerciseId?: string): string {
  const done = sets.filter(setCounts);
  if (!done.length) return "";
  const kg = done[0].kg;
  if (measure === "weight_reps" && kg != null && done.every((set) => set.kg === kg && set.reps != null)) {
    return `${number(kg)} kg × ${done.map((set) => set.reps).join(", ")}`;
  }
  return done.map((set) => formatSet(set, measure, exerciseId)).join(", ");
}


/** "12:40 · 4 of 16 sets": how long it has run and the sets ticked off, for the sheet and the Train card. */
export function workoutStatus(workout: DraftWorkout, now: number): string {
  const totals = workoutTotals(workout);
  return `${clock(workout.startedAt ? (now - Date.parse(workout.startedAt)) / 1000 : 0)} · ${totals.sets} of ${totals.plannedSets} ${totals.plannedSets === 1 ? "set" : "sets"}`;
}

/** A saved workout back as a draft to edit: each run of one exercise's sets is an exercise; a block that holds more than one exercise is a superset. */
export function fromSaved(saved: {
  id: string; date: string; name: string | null; startedAt: string | null; endedAt: string | null; sets: readonly SavedSet[];
  status?: string; planWorkoutId?: string | null; sequencePosition?: number | null; blocks?: readonly TimedBlockBody[];
}): DraftWorkout {
  const exercises: DraftExercise[] = [];
  let last: { block: number; exerciseId: string } | null = null;
  for (const set of saved.sets) {
    if (!last || last.block !== set.block || last.exerciseId !== set.exerciseId) {
      const joined = last?.block === set.block;
      const timed = joined ? undefined : saved.blocks?.find((block) => block.block === set.block);
      exercises.push({
        key: `e${exercises.length + 1}`, exerciseId: set.exerciseId, sets: [],
        ...(joined ? { superset: true } : {}), ...(timed ? { timed: fromBlockBody(timed) } : {}),
      });
      last = { block: set.block, exerciseId: set.exerciseId };
    }
    exercises[exercises.length - 1].sets.push({
      type: set.type, kg: set.kg, reps: set.reps, rir: set.rir, seconds: set.seconds, metres: set.metres, doneAt: set.doneAt,
    });
  }
  const plan = saved.planWorkoutId != null && saved.sequencePosition != null ? { workoutId: saved.planWorkoutId, position: saved.sequencePosition } : null;
  return {
    id: saved.id, date: saved.date, startedAt: saved.startedAt, endedAt: saved.endedAt, name: saved.name, exercises, restEndsAt: null, restFor: 0,
    plan, skipped: saved.status === "skipped",
  };
}

/** "Mon 23 Nov". */
export function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(parse(date));
}

/** A history row's second line: "Bench Press, Squat +2 · 12 sets · 4,560 kg", and a run's "Run · 1 set · 5 km". */
export function historyLine(row: { exercises: readonly string[]; sets: number; volumeKg: number; metres?: number; status?: string }, nameOf: (id: string) => string): string {
  if (row.status === "skipped" && !row.sets) return "Skipped";
  const names = row.exercises.slice(0, 2).map(nameOf).join(", ");
  const more = row.exercises.length > 2 ? ` +${row.exercises.length - 2}` : "";
  const parts = [`${names}${more}` || "No exercises", `${row.sets} ${row.sets === 1 ? "set" : "sets"}`];
  if (row.volumeKg > 0) parts.push(`${Math.round(row.volumeKg).toLocaleString("en-GB")} kg`);
  if (row.metres) parts.push(distanceText(row.metres));
  return parts.join(" · ");
}

/**
 * Swapping an exercise for another in a workout (docs/training.md, phase 5). Sets not ticked off yet move to the new
 * exercise, empty, with their types; ticked ones stay with the old exercise, which keeps its place. With nothing
 * ticked the old one goes. With everything ticked the new one gets as many sets again. The plan target carries over.
 */
export function swapExercise(exercise: DraftExercise, exerciseId: string, newKey: string): { keep: DraftExercise | null; next: DraftExercise } {
  const ticked = exercise.sets.filter((set) => set.doneAt);
  const left = exercise.sets.filter((set) => !set.doneAt);
  const types = (left.length ? left : exercise.sets).map((set) => set.type);
  const next: DraftExercise = {
    key: ticked.length ? newKey : exercise.key, exerciseId, sets: types.map((type) => emptySet(type)), target: exercise.target ?? null,
    ...(exercise.part ? { part: exercise.part } : {}),
  };
  return { keep: ticked.length ? { ...exercise, sets: ticked } : null, next: exercise.superset ? { ...next, superset: true } : next };
}

/**
 * The exercises in runs done together (docs/training.md, phase 6): a run starts at each exercise that isn't joined to
 * the one before it. Straight sets are a run of one.
 */
export function exerciseGroups<T extends Pick<DraftExercise, "superset">>(exercises: readonly T[]): T[][] {
  const runs: T[][] = [];
  exercises.forEach((exercise, at) => {
    if (at > 0 && exercise.superset) runs[runs.length - 1].push(exercise);
    else runs.push([exercise]);
  });
  return runs;
}

/** The run an exercise is in: itself alone, or its whole superset. */
export function groupOf(exercises: readonly DraftExercise[], key: string): DraftExercise[] {
  return exerciseGroups(exercises).find((run) => run.some((exercise) => exercise.key === key)) ?? [];
}

/** "Superset" for two, "Circuit" for three or more. */
export function groupName(size: number): string {
  return size > 2 ? "Circuit" : "Superset";
}

/**
 * Whether set `index` ends a round: every exercise in its run that has a set at that place has it ticked off. Rest
 * starts then, not between the exercises of a superset. Straight sets end a round with each set.
 */
export function roundDone(exercises: readonly DraftExercise[], key: string, index: number): boolean {
  return groupOf(exercises, key).every((exercise) => !exercise.sets[index] || exercise.sets[index].doneAt != null);
}

/** Joins an exercise to the run before it, or splits it off again. The first exercise has nothing to join. */
export function toggleSuperset(exercises: readonly DraftExercise[], key: string): DraftExercise[] {
  const at = exercises.findIndex((exercise) => exercise.key === key);
  // Never across the warm-up, the workout and the cool-down.
  if (at < 1 || !samePart(exercises[at - 1], exercises[at])) return [...exercises];
  // Joined, it follows its new run's clock; a clock it led goes.
  return exercises.map((exercise, index) => (index === at ? { ...exercise, superset: !exercise.superset, timed: null } : exercise));
}

/**
 * Takes an exercise out. When it started a superset, the one after it starts the run instead (with its clock), so
 * the rest stay together and don't join the run before. `led` says so, for Undo.
 */
export function withoutExercise(exercises: readonly DraftExercise[], at: number): { exercises: DraftExercise[]; led: boolean } {
  const rest = exercises.filter((_, index) => index !== at);
  const led = !exercises[at]?.superset && !!exercises[at + 1]?.superset;
  if (led) rest[at] = { ...rest[at], superset: false, timed: exercises[at].timed ?? null };
  return { exercises: rest, led };
}

/** Whether two exercises are in the same part: both warm-up, both the workout itself, or both cool-down. */
export function samePart(a: Pick<DraftExercise, "part"> | undefined, b: Pick<DraftExercise, "part"> | undefined): boolean {
  return (a?.part ?? null) === (b?.part ?? null);
}

const PART_TITLES: Record<WorkoutPart | "main", string> = { warmup: "Warm-up", main: "Workout", cooldown: "Cool-down" };

/**
 * The heading over a run of exercises: "Warm-up", "Workout" or "Cool-down" where the part changes, else null.
 * A workout with no warm-up or cool-down has no headings at all.
 */
export function partHeading(runs: readonly (readonly Pick<DraftExercise, "part">[])[], index: number): string | null {
  if (!runs.some((run) => run[0]?.part)) return null;
  const part = runs[index]?.[0]?.part ?? "main";
  const before = index > 0 ? (runs[index - 1][0]?.part ?? "main") : null;
  return part === before ? null : PART_TITLES[part];
}

/** Where an added exercise goes: before the cool-down, so it's part of the workout itself. */
export function addIndex(exercises: readonly Pick<DraftExercise, "part">[]): number {
  const at = exercises.findIndex((exercise) => exercise.part === "cooldown");
  return at < 0 ? exercises.length : at;
}
