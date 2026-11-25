import { markRaw, reactive } from "vue";
import { ApiError, getPreviousSets, putWorkout, ServerUnreachable, type PreviousSets } from "../api";
import { todayInZone } from "../lib/dates";
import {
  emptySet,
  finished,
  measureFields,
  restSeconds,
  setHints,
  toggleSet,
  toRequest,
  type DraftExercise,
  type DraftWorkout,
  type SetField,
  type SetType,
} from "../lib/workout";
import { exercises } from "./exercises";
import { deviceTimeZone } from "./profile";

/**
 * The workout being logged, kept in localStorage per account so it survives closing the app, and
 * finished workouts the server hasn't taken yet. A finished workout is sent whole under its own id,
 * so sending it again after a lost answer can't save it twice.
 */
export const workout = reactive({
  active: null as DraftWorkout | null,
  /** Finished, waiting to send. */
  pending: [] as DraftWorkout[],
  /** "Last time" per exercise id, for the set table. Missing until loaded, or never done. */
  previous: {} as Record<string, PreviousSets | null>,
  /** The workout just finished, for the summary. */
  summary: null as DraftWorkout | null,
  saving: false,
});

let account = "";
let keySeq = 0;

const activeKey = () => `gymbro-workout:${account}`;
const pendingKey = () => `gymbro-workouts-pending:${account}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!account) return;
  try {
    if (value == null || (Array.isArray(value) && !value.length)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the workout still lives until the app closes.
  }
}

/** Loads this account's workout in progress and its unsent workouts. */
export function useWorkoutAccount(id: string): void {
  account = id;
  workout.active = readJson<DraftWorkout | null>(activeKey(), null);
  workout.pending = readJson<DraftWorkout[]>(pendingKey(), []);
  keySeq = Math.max(0, ...(workout.active?.exercises ?? []).map((exercise) => Number(exercise.key.slice(1)) || 0));
  if (workout.active) for (const exercise of workout.active.exercises) void loadPrevious(exercise.exerciseId);
}

function save(): void {
  writeJson(activeKey(), workout.active);
}

function newId(): string {
  return crypto.randomUUID();
}

export function startWorkout(now = new Date()): DraftWorkout {
  if (workout.active) return workout.active;
  workout.summary = null;
  workout.active = {
    id: newId(),
    date: todayInZone(deviceTimeZone(), now),
    startedAt: now.toISOString(),
    endedAt: null,
    name: null,
    exercises: [],
    restEndsAt: null,
    restFor: 0,
  };
  save();
  return workout.active;
}

async function loadPrevious(exerciseId: string): Promise<void> {
  if (exerciseId in workout.previous) return;
  try {
    const found = await getPreviousSets([exerciseId], workout.active?.id);
    workout.previous[exerciseId] = found[exerciseId] ? markRaw(found[exerciseId]) : null;
  } catch {
    // Offline with nothing kept: the set table shows no "last time".
  }
}

/** Adds an exercise with as many sets as last time (3 when it is new), and loads its "last time". */
export async function addExercise(exerciseId: string): Promise<string> {
  const active = workout.active ?? startWorkout();
  await loadPrevious(exerciseId);
  const last = workout.previous[exerciseId];
  const count = last ? Math.min(Math.max(last.sets.filter((set) => set.type !== "warmup").length, 1), 10) : 3;
  const sets = Array.from({ length: count }, () => emptySet());
  const key = `e${++keySeq}`;
  active.exercises.push({ key, exerciseId, sets });
  save();
  return key;
}

function find(key: string): DraftExercise | undefined {
  return workout.active?.exercises.find((exercise) => exercise.key === key);
}

export function addSet(key: string, type: SetType = "working"): void {
  const exercise = find(key);
  if (!exercise) return;
  if (type === "warmup") {
    const at = exercise.sets.findIndex((set) => set.type !== "warmup");
    exercise.sets.splice(at < 0 ? exercise.sets.length : at, 0, emptySet("warmup"));
  } else {
    exercise.sets.push(emptySet(type));
  }
  save();
}

export function removeSet(key: string, index: number): void {
  const exercise = find(key);
  if (!exercise) return;
  exercise.sets.splice(index, 1);
  save();
}

/** Takes an exercise out, and returns it with where it was, for Undo. */
export function removeExercise(key: string): { exercise: DraftExercise; at: number } | null {
  const active = workout.active;
  const at = active?.exercises.findIndex((exercise) => exercise.key === key) ?? -1;
  if (!active || at < 0) return null;
  const [exercise] = active.exercises.splice(at, 1);
  save();
  return { exercise, at };
}

/** Undo for removeExercise. */
export function restoreExercise(removed: { exercise: DraftExercise; at: number }): void {
  const active = workout.active;
  if (!active || active.exercises.some((exercise) => exercise.key === removed.exercise.key)) return;
  active.exercises.splice(Math.min(removed.at, active.exercises.length), 0, removed.exercise);
  save();
}

export function setValue(key: string, index: number, field: SetField, value: number | null): void {
  const set = find(key)?.sets[index];
  if (!set) return;
  set[field] = value;
  save();
}

export function exerciseItem(exerciseId: string) {
  return exercises.items.find((item) => item.id === exerciseId) ?? null;
}

/** Ticks a set off (or back on). A ticked working set starts the rest timer for its exercise. */
export function toggleDone(key: string, index: number, now = new Date()): void {
  const active = workout.active;
  const exercise = find(key);
  const set = exercise?.sets[index];
  const item = exercise ? exerciseItem(exercise.exerciseId) : null;
  if (!active || !exercise || !set) return;
  const fields = measureFields(item?.measure ?? "weight_reps");
  const hints = setHints(exercise, index, workout.previous[exercise.exerciseId]?.sets ?? []);
  const next = toggleSet(set, hints, fields, now);
  exercise.sets[index] = next;
  const rest = next.doneAt && item ? restSeconds(item) : 0;
  if (rest) {
    active.restFor = rest;
    active.restEndsAt = new Date(now.getTime() + rest * 1000).toISOString();
  } else if (!next.doneAt) {
    active.restEndsAt = null;
  }
  save();
}

/** −15, +15 or Skip on the rest timer. */
export function shiftRest(seconds: number | null, now = new Date()): void {
  const active = workout.active;
  if (!active?.restEndsAt) return;
  if (seconds == null) {
    active.restEndsAt = null;
  } else {
    const ends = Math.max(now.getTime(), Date.parse(active.restEndsAt) + seconds * 1000);
    active.restEndsAt = new Date(ends).toISOString();
    active.restFor = Math.max(1, active.restFor + seconds);
  }
  save();
}

export function discardWorkout(): void {
  workout.active = null;
  save();
}

/**
 * Finishes the workout: sets not ticked off are left out, and it is sent. Offline it waits on the
 * phone and goes when the server answers. A refusal ("failed") keeps the workout open.
 */
export async function finishWorkout(now = new Date()): Promise<"saved" | "waiting" | "failed"> {
  const active = workout.active;
  if (!active) return "failed";
  const done = finished(active, now);
  let outcome: "saved" | "waiting" | "failed";
  workout.saving = true;
  try {
    await putWorkout(done.id, toRequest(done, deviceTimeZone()));
    outcome = "saved";
  } catch (error) {
    if (error instanceof ApiError) {
      outcome = "failed";
    } else {
      workout.pending = [...workout.pending.filter((item) => item.id !== done.id), done];
      writeJson(pendingKey(), workout.pending);
      outcome = "waiting";
    }
  } finally {
    workout.saving = false;
  }
  // A refused workout stays open, so nothing typed is lost.
  if (outcome !== "failed") {
    workout.summary = done;
    workout.active = null;
    save();
    for (const exercise of done.exercises) delete workout.previous[exercise.exerciseId];
  }
  return outcome;
}

/** Sends finished workouts that were waiting, oldest first. */
export async function sendPendingWorkouts(): Promise<number> {
  let sent = 0;
  for (const item of [...workout.pending]) {
    try {
      await putWorkout(item.id, toRequest(item, deviceTimeZone()));
    } catch (error) {
      if (error instanceof ServerUnreachable) break;
      // Refused (the server's rules changed, or a bad value): drop it rather than retry forever.
    }
    workout.pending = workout.pending.filter((other) => other.id !== item.id);
    writeJson(pendingKey(), workout.pending);
    sent += 1;
  }
  return sent;
}

export function closeSummary(): void {
  workout.summary = null;
}
