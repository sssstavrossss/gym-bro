import { markRaw, reactive } from "vue";
import { ApiError, deleteWorkout, getPreviousSets, getWorkout, listWorkouts, putWorkout, ServerUnreachable, type PreviousSets, type WorkoutSummary } from "../api";
import { addDays, todayInZone } from "../lib/dates";
import {
  dropUndone,
  emptySet,
  finished,
  fromSaved,
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
import { targetOf, weekSets, type UpNext } from "../lib/plan";
import { loadTargetOf, suggestLoad, type LoadSuggestion, type LoadTarget } from "../lib/progression";
import { exercises } from "./exercises";
import { loadPlan } from "./plan";
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
  /** A past workout open to edit, or a new one being logged afterwards. The sheet edits it instead of the live one. */
  past: null as null | { draft: DraftWorkout; isNew: boolean },
});

/** Train's history: the last year of workouts, newest first. */
export const workoutHistory = reactive({
  state: "idle" as "idle" | "loading" | "ready" | "failed",
  rows: [] as WorkoutSummary[],
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

/**
 * Starts the plan's next workout: its exercises in order, each with this week's sets (half in a lighter
 * week) and its target. Saved with the plan workout and its place, which moves the plan on.
 */
export function startPlanWorkout(next: UpNext, now = new Date()): DraftWorkout {
  if (workout.active) return workout.active;
  const active = startWorkout(now);
  active.name = next.workout.name;
  active.plan = { workoutId: next.workout.id, position: next.position };
  active.exercises = next.workout.exercises.map((exercise) => ({
    key: `e${++keySeq}`,
    exerciseId: exercise.exerciseId,
    sets: Array.from({ length: weekSets(exercise, next.lighter) }, () => emptySet()),
    target: targetOf(exercise, next),
  }));
  save();
  for (const exercise of active.exercises) void loadPrevious(exercise.exerciseId);
  return active;
}

export const SKIP_OFFLINE = "You're offline. Skipping a workout needs a connection.";

/** Skips the plan's next workout: saved as skipped today, so the one after is next. Returns its id, or what went wrong. */
export async function skipPlanWorkout(next: UpNext): Promise<{ id: string } | { error: string }> {
  const skipped: DraftWorkout = {
    id: newId(), date: today(), startedAt: null, endedAt: null, name: next.workout.name, exercises: [], restEndsAt: null, restFor: 0,
    plan: { workoutId: next.workout.id, position: next.position }, skipped: true,
  };
  try {
    await putWorkout(skipped.id, toRequest(skipped, deviceTimeZone()));
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : SKIP_OFFLINE };
  }
  refresh();
  return { id: skipped.id };
}

/** Undo for Skip. */
export async function unskipPlanWorkout(id: string): Promise<boolean> {
  try {
    await deleteWorkout(id);
  } catch {
    return false;
  }
  refresh();
  return true;
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
  const active = editing() ?? startWorkout();
  await loadPrevious(exerciseId);
  const last = workout.previous[exerciseId];
  const count = last ? Math.min(Math.max(last.sets.filter((set) => set.type !== "warmup").length, 1), 10) : 3;
  const sets = Array.from({ length: count }, () => emptySet());
  const key = `e${++keySeq}`;
  active.exercises.push({ key, exerciseId, sets });
  save();
  return key;
}

/** The workout the sheet is editing: a past one when open, else the live one. */
function editing(): DraftWorkout | null {
  return workout.past?.draft ?? workout.active;
}

function find(key: string): DraftExercise | undefined {
  return editing()?.exercises.find((exercise) => exercise.key === key);
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
  const active = editing();
  const at = active?.exercises.findIndex((exercise) => exercise.key === key) ?? -1;
  if (!active || at < 0) return null;
  const [exercise] = active.exercises.splice(at, 1);
  save();
  return { exercise, at };
}

/** Undo for removeExercise. */
export function restoreExercise(removed: { exercise: DraftExercise; at: number }): void {
  const active = editing();
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

/** What an exercise in the live workout progresses against; null for one it doesn't apply to. */
export function exerciseLoadTarget(exercise: DraftExercise): LoadTarget | null {
  const item = exerciseItem(exercise.exerciseId);
  return item ? loadTargetOf(exercise.target, item.measure, item.mechanic) : null;
}

/** The suggested weight for an exercise in the live workout, from its last two times (lib/progression.ts). */
export function exerciseSuggestion(exercise: DraftExercise): LoadSuggestion | null {
  const last = workout.previous[exercise.exerciseId];
  const target = exerciseLoadTarget(exercise);
  if (!last || !target) return null;
  return suggestLoad(last.sets, last.earlier?.sets ?? null, target, exerciseItem(exercise.exerciseId)?.equipment);
}

/** Ticks a set off (or back on). In the live workout a ticked working set starts the rest timer. */
export function toggleDone(key: string, index: number, now = new Date()): void {
  const active = editing();
  const exercise = find(key);
  const set = exercise?.sets[index];
  const item = exercise ? exerciseItem(exercise.exerciseId) : null;
  if (!active || !exercise || !set) return;
  const fields = measureFields(item?.measure ?? "weight_reps");
  const live = active === workout.active;
  const hints = setHints(exercise, index, workout.previous[exercise.exerciseId]?.sets ?? [], live ? exerciseSuggestion(exercise) : null);
  const next = toggleSet(set, hints, fields, now);
  exercise.sets[index] = next;
  if (!live) return;
  const rest = next.doneAt && item ? exercise.target?.restSeconds ?? restSeconds(item) : 0;
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
    if (outcome === "saved") refresh();
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
  if (sent) refresh();
  return sent;
}

export function closeSummary(): void {
  workout.summary = null;
}

/** After a workout is saved, changed or deleted: the history, and the plan's place in its sequence. */
function refresh(): void {
  void loadHistory();
  void loadPlan();
}

function today(): string {
  return todayInZone(deviceTimeZone());
}

/** Loads the last year of workouts for Train's history. Offline, the last copy shows. */
export async function loadHistory(): Promise<void> {
  if (workoutHistory.state === "idle" || workoutHistory.state === "failed") workoutHistory.state = "loading";
  const to = today();
  try {
    workoutHistory.rows = markRaw(await listWorkouts(addDays(to, -365), to));
    workoutHistory.state = "ready";
  } catch {
    if (workoutHistory.state !== "ready") workoutHistory.state = "failed";
  }
}

/** Opens a saved workout to edit. False when it can't be loaded (offline and never opened). */
export async function openPast(id: string): Promise<boolean> {
  try {
    const saved = await getWorkout(id);
    workout.past = { draft: fromSaved(saved), isNew: false };
    for (const exercise of workout.past.draft.exercises) void loadPrevious(exercise.exerciseId);
    return true;
  } catch {
    return false;
  }
}

/** Starts logging a workout afterwards: on the day given (the day Today shows), else today. Never a future day. */
export function newPast(date?: string): void {
  const now = today();
  workout.past = {
    draft: { id: newId(), date: date && date <= now ? date : now, startedAt: null, endedAt: null, name: null, exercises: [], restEndsAt: null, restFor: 0 },
    isNew: true,
  };
}

export function closePast(): void {
  workout.past = null;
}

export const PAST_NOTHING = "Tick off a set to save the workout.";
export const PAST_OFFLINE = "You're offline. Saving a past workout needs a connection.";

/** Saves the past workout being edited. Returns null when saved, else what went wrong. */
export async function savePast(): Promise<string | null> {
  const past = workout.past;
  if (!past || workout.saving) return null;
  const done = dropUndone(past.draft);
  if (!done.exercises.length) return PAST_NOTHING;
  workout.saving = true;
  try {
    await putWorkout(done.id, toRequest(done, deviceTimeZone()));
  } catch (error) {
    return error instanceof ApiError ? error.message : PAST_OFFLINE;
  } finally {
    workout.saving = false;
  }
  workout.past = null;
  for (const exercise of done.exercises) delete workout.previous[exercise.exerciseId];
  refresh();
  return null;
}

/** Deletes the past workout being edited. Returns it for Undo, or null with nothing done. */
export async function deletePast(): Promise<DraftWorkout | string> {
  const past = workout.past;
  if (!past) return "";
  const kept = dropUndone(past.draft);
  if (!past.isNew) {
    try {
      await deleteWorkout(kept.id);
    } catch (error) {
      return error instanceof ApiError ? error.message : PAST_OFFLINE;
    }
  }
  workout.past = null;
  workout.previous = {};
  refresh();
  return kept;
}

/** Undo for a delete: the same workout, under the same id. */
export async function restorePast(kept: DraftWorkout): Promise<boolean> {
  try {
    await putWorkout(kept.id, toRequest(kept, deviceTimeZone()));
    workout.previous = {};
    refresh();
    return true;
  } catch {
    return false;
  }
}
