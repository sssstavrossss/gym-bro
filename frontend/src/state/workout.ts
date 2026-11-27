import { markRaw, reactive } from "vue";
import { ApiError, deleteWorkout, getPreviousSets, getWorkout, listWorkouts, putWorkout, ServerUnreachable, type DescribedWorkoutExercise, type PreviousSets, type WorkoutSummary } from "../api";
import { describedExercises } from "../lib/describeWorkout";
import { addDays, todayInZone } from "../lib/dates";
import {
  addIndex,
  dropUndone,
  emptySet,
  swapExercise as swapSets,
  finished,
  fromSaved,
  groupOf,
  measureFields,
  restSeconds,
  roundDone,
  toggleSuperset as joinNext,
  withoutExercise,
  setHints,
  startingSets,
  toggleSet,
  toRequest,
  type DraftExercise,
  type DraftWorkout,
  type SetField,
  type SetType,
  type WorkoutPart,
} from "../lib/workout";
import { targetOf, weekSets, type PlanExercise, type UpNext } from "../lib/plan";
import type { RepeatSource } from "../lib/train";
import { loadTargetOf, suggestLoad, type LoadSuggestion, type LoadTarget } from "../lib/progression";
import { newBests, type NewBest } from "../lib/records";
import { warmupRamp, workingKg } from "../lib/warmup";
import { fitSets, MAX_EVERY, MAX_EXTRA_REPS, MAX_MINUTES, MIN_MINUTES, newTimed, nextRoundSet, plannedRounds, stopped, type BlockFormat, type TimedState } from "../lib/timed";
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
  /** The finished workout's new personal records, for the summary. */
  bests: [] as NewBest[],
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

/**
 * The times set on Quick add's Add exercise before anything is added. Nothing has started then (README, *Logging a
 * workout*): they wait here, and the first exercise starts the workout with them. Closing the sheet forgets them.
 */
export const quickTimes = reactive<{ startedAt: string | null; endedAt: string | null; timesSet: boolean }>({ startedAt: null, endedAt: null, timesSet: false });

export function forgetQuickTimes(): void {
  Object.assign(quickTimes, { startedAt: null, endedAt: null, timesSet: false });
}

/**
 * Quick add opens the sheet with nothing started: the workout begins when the first exercise goes in (`addExercise`,
 * `addDescribed`). Clears the last workout's summary so the sheet opens on Add exercise.
 */
export function readyQuickAdd(): void {
  if (workout.active) return;
  workout.summary = null;
  workout.bests = [];
  forgetQuickTimes();
}

/** Starts a workout now, or with the times set on Add exercise before it began. Returns the one going if there is one. */
export function startWorkout(now = new Date()): DraftWorkout {
  if (workout.active) return workout.active;
  workout.summary = null;
  workout.bests = [];
  const startedAt = quickTimes.timesSet && quickTimes.startedAt ? quickTimes.startedAt : now.toISOString();
  workout.active = {
    id: newId(),
    date: todayInZone(deviceTimeZone(), new Date(startedAt)),
    startedAt,
    endedAt: quickTimes.timesSet ? quickTimes.endedAt : null,
    name: null,
    exercises: [],
    restEndsAt: null,
    restFor: 0,
    ...(quickTimes.timesSet ? { timesSet: true } : {}),
  };
  forgetQuickTimes();
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
  // A plan circuit starts joined, and on the clock when it's done for time, as an EMOM or as an AMRAP (with its minutes).
  const main: DraftExercise[] = next.workout.exercises.map((exercise, index) => ({
    key: `e${++keySeq}`,
    exerciseId: exercise.exerciseId,
    sets: Array.from({ length: weekSets(exercise, next.lighter) }, () => emptySet()),
    target: targetOf(exercise, next),
    superset: index > 0 && !!exercise.superset,
    timed: exercise.format && !exercise.superset
      ? { ...newTimed(exercise.format), ...(exercise.format !== "for_time" && exercise.minutes ? { minutes: exercise.minutes } : {}) }
      : null,
  }));
  // The warm-up's moves and the cool-down's stretches are one set each, whatever the week.
  const mobility = (list: PlanExercise[] | null | undefined, part: WorkoutPart): DraftExercise[] => (list ?? []).map((exercise) => ({
    key: `e${++keySeq}`, exerciseId: exercise.exerciseId, sets: Array.from({ length: exercise.sets }, () => emptySet()), target: targetOf(exercise, next), part,
  }));
  active.exercises = [...mobility(next.workout.warmUp, "warmup"), ...main, ...mobility(next.workout.coolDown, "cooldown")];
  // An EMOM gets a set each round, whatever the plan's (or the lighter week's) count.
  for (const exercise of [...active.exercises]) if (exercise.timed) fitEmom(active, exercise.key);
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

/** Adds an exercise with as many sets as last time (3 when it is new, 1 for cardio: one run), and loads its "last time". */
export async function addExercise(exerciseId: string, now = new Date()): Promise<string> {
  const active = editing() ?? startWorkout(now);
  // A quick workout emptied again starts over at the next first exercise, unless its start was set by hand.
  if (active === workout.active && !active.exercises.length && !active.timesSet && !active.plan) active.startedAt = now.toISOString();
  await loadPrevious(exerciseId);
  const last = workout.previous[exerciseId];
  const sets = Array.from({ length: startingSets(last, exerciseItem(exerciseId)?.category === "cardio") }, () => emptySet());
  const key = `e${++keySeq}`;
  active.exercises.splice(addIndex(active.exercises), 0, { key, exerciseId, sets });
  save();
  return key;
}

/**
 * Starts a workout again (Train's Repeat): its name and exercises in order, each with as many empty sets as last
 * time, so the set table's "last time" and the load suggestions guide it. Not tied to a plan.
 */
export async function repeatWorkout(source: RepeatSource, now = new Date()): Promise<DraftWorkout> {
  if (workout.active) return workout.active;
  const ids = source.exercises.filter((id) => !(id in workout.previous));
  if (ids.length) {
    try {
      const found = await getPreviousSets(ids);
      for (const id of ids) workout.previous[id] = found[id] ? markRaw(found[id]) : null;
    } catch {
      // Offline with nothing kept: each exercise starts with the usual sets.
    }
  }
  if (workout.active) return workout.active;
  const active = startWorkout(now);
  active.name = source.name;
  active.exercises = source.exercises.map((exerciseId) => ({
    key: `e${++keySeq}`,
    exerciseId,
    sets: Array.from({ length: startingSets(workout.previous[exerciseId], exerciseItem(exerciseId)?.category === "cardio") }, () => emptySet()),
  }));
  save();
  return active;
}

/**
 * Adds the exercises "Describe a workout" found, their sets ticked off (lib/describeWorkout.ts), and loads each
 * one's "last time". Starts a workout when none is running. Returns what was added.
 */
export async function addDescribed(found: DescribedWorkoutExercise[], now = new Date()): Promise<DraftExercise[]> {
  const active = editing() ?? startWorkout(now);
  const added = describedExercises(found, () => `e${++keySeq}`, now.toISOString());
  active.exercises.push(...added);
  save();
  await Promise.all(added.map((exercise) => loadPrevious(exercise.exerciseId)));
  return added;
}

/**
 * Swaps an exercise for another: sets not ticked off move to the new one, ticked ones stay (lib/workout.ts
 * `swapExercise`). Returns the new exercise's key, or null when it isn't there.
 */
export async function swapExercise(key: string, exerciseId: string): Promise<string | null> {
  const active = editing();
  const at = active?.exercises.findIndex((exercise) => exercise.key === key) ?? -1;
  if (!active || at < 0) return null;
  const { keep, next } = swapSets(active.exercises[at], exerciseId, `e${++keySeq}`);
  active.exercises.splice(at, 1, ...(keep ? [keep, next] : [next]));
  save();
  await loadPrevious(exerciseId);
  return next.key;
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

/**
 * "+ Warm-up": with no warm-ups yet and a weight to work up to (typed, suggested or last time's), fills in the
 * ramp before the first working set (lib/warmup.ts) and returns it; otherwise adds one empty warm-up and returns null.
 */
export function addWarmups(key: string): { count: number; workKg: number } | null {
  const exercise = find(key);
  if (!exercise) return null;
  const item = exerciseItem(exercise.exerciseId);
  const hasWarmup = exercise.sets.some((set) => set.type === "warmup");
  const workKg = hasWarmup || (item?.measure ?? "weight_reps") !== "weight_reps"
    ? null
    : workingKg(exercise.sets, exerciseSuggestion(exercise)?.kg, workout.previous[exercise.exerciseId]?.sets ?? []);
  const ramp = workKg == null ? [] : warmupRamp(workKg, item?.equipment, item?.mechanic);
  if (!ramp.length) {
    addSet(key, "warmup");
    return null;
  }
  const at = exercise.sets.findIndex((set) => set.type !== "warmup");
  exercise.sets.splice(at < 0 ? exercise.sets.length : at, 0, ...ramp.map((step) => ({ ...emptySet("warmup"), kg: step.kg, reps: step.reps })));
  save();
  return { count: ramp.length, workKg: workKg! };
}

export function removeSet(key: string, index: number): void {
  const exercise = find(key);
  if (!exercise) return;
  exercise.sets.splice(index, 1);
  save();
}

/** Takes an exercise out, and returns it with where it was, for Undo. */
export interface RemovedExercise {
  exercise: DraftExercise;
  at: number;
  /** It started a superset, so the one after it took over. */
  led: boolean;
}

export function removeExercise(key: string): RemovedExercise | null {
  const active = editing();
  const at = active?.exercises.findIndex((exercise) => exercise.key === key) ?? -1;
  if (!active || at < 0) return null;
  const exercise = active.exercises[at];
  const { exercises, led } = withoutExercise(active.exercises, at);
  active.exercises = exercises;
  save();
  return { exercise, at, led };
}

/** Undo for removeExercise. */
export function restoreExercise(removed: RemovedExercise): void {
  const active = editing();
  if (!active || active.exercises.some((exercise) => exercise.key === removed.exercise.key)) return;
  const at = Math.min(removed.at, active.exercises.length);
  active.exercises.splice(at, 0, removed.exercise);
  const after = active.exercises[at + 1];
  if (removed.led && after) active.exercises[at + 1] = { ...after, superset: true, timed: null };
  save();
}

/** The run that `key` leads, with its index in the workout; null when it doesn't lead one. */
function runAt(active: DraftWorkout, key: string): { at: number; run: DraftExercise[] } | null {
  const at = active.exercises.findIndex((exercise) => exercise.key === key);
  if (at < 0 || active.exercises[at].superset) return null;
  return { at, run: groupOf(active.exercises, key) };
}

function changeTimed(key: string, change: (timed: TimedState) => TimedState | null): void {
  const active = editing();
  const found = active ? runAt(active, key) : null;
  const timed = found?.run[0].timed;
  if (!active || !found || !timed) return;
  active.exercises[found.at] = { ...found.run[0], timed: change(timed) };
  fitEmom(active, key);
  save();
}

/** An EMOM has one round each interval, so each exercise in it gets that many working sets. */
function fitEmom(active: DraftWorkout, key: string): void {
  const run = groupOf(active.exercises, key);
  const timed = run[0]?.timed;
  if (timed?.format !== "emom") return;
  const rounds = plannedRounds(timed, run) ?? 1;
  for (const exercise of run) {
    const at = active.exercises.indexOf(exercise);
    active.exercises[at] = fitSets(exercise, rounds);
  }
}

/** Does the run `key` leads on the clock in `format`, or as plain rounds (null). */
export function setBlockFormat(key: string, format: BlockFormat | null): void {
  const active = editing();
  const found = active ? runAt(active, key) : null;
  if (!active || !found) return;
  const head = found.run[0];
  if ((head.timed?.format ?? null) === format) return;
  active.exercises[found.at] = { ...head, timed: format ? newTimed(format, head.timed) : null };
  fitEmom(active, key);
  save();
}

export function stepBlockMinutes(key: string, delta: number): void {
  changeTimed(key, (timed) => ({ ...timed, minutes: Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, timed.minutes + delta)) }));
}

export function stepBlockEvery(key: string, delta: number): void {
  changeTimed(key, (timed) => {
    const every = Math.min(MAX_EVERY, Math.max(1, timed.every + delta));
    return { ...timed, every, minutes: Math.max(every, timed.minutes) };
  });
}

export function stepExtraReps(key: string, delta: number): void {
  changeTimed(key, (timed) => {
    const reps = Math.min(MAX_EXTRA_REPS, Math.max(0, (timed.reps ?? 0) + delta));
    return { ...timed, reps: reps || null };
  });
}

/** Starts the run's clock. A rest still running ends: the clock is the rest now. */
export function startClock(key: string, now = new Date()): void {
  const active = workout.active;
  if (!active) return;
  active.restEndsAt = null;
  const found = runAt(active, key);
  const timed = found?.run[0].timed;
  if (!found || !timed || timed.startedAt) return;
  active.exercises[found.at] = { ...found.run[0], timed: { ...timed, startedAt: now.toISOString(), endedAt: null, seconds: null } };
  save();
}

export function stopClock(key: string, now = new Date()): void {
  const active = workout.active;
  const found = active ? runAt(active, key) : null;
  const timed = found?.run[0].timed;
  if (!active || !found || !timed) return;
  active.exercises[found.at] = { ...found.run[0], timed: stopped(timed, now) };
  save();
}

/** Round done: ticks the next set of each exercise in the run. An AMRAP adds a set like the last when it runs out. */
export function tickRound(key: string, now = new Date()): void {
  const active = workout.active;
  const found = active ? runAt(active, key) : null;
  const format = found?.run[0].timed?.format;
  if (!active || !found || !format) return;
  for (const exercise of found.run) {
    const next = nextRoundSet(exercise, format);
    if (!next) continue;
    if (next.exercise !== exercise) active.exercises[active.exercises.indexOf(exercise)] = next.exercise;
    toggleDone(next.exercise.key, next.index, now);
  }
}

/** Joins an exercise to the one before it as a superset, or splits it off. */
export function toggleSuperset(key: string): void {
  const active = editing();
  if (!active) return;
  active.exercises = joinNext(active.exercises, key);
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

/** A new personal record set in the live workout so far on this exercise (every card of it), or null. */
export function exerciseNewBest(exercise: DraftExercise): NewBest | null {
  const same = workout.active?.exercises.filter((item) => item.exerciseId === exercise.exerciseId) ?? [exercise];
  return newBests(same, (id) => workout.previous[id]?.best)[0] ?? null;
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
  // In a superset the rest comes after the round, the longest any of its exercises asks for; between them there is none.
  // A block on the clock has no rest timer: the clock is the rest. For time stops once every round is ticked.
  const group = groupOf(active.exercises, key);
  const timed = group[0]?.timed;
  if (timed?.format === "for_time" && timed.startedAt && !timed.endedAt && group.every((each) => each.sets.every((one) => one.doneAt))) {
    active.exercises[active.exercises.indexOf(group[0])] = { ...group[0], timed: stopped(timed, now) };
  }
  const endsRound = roundDone(active.exercises, key, index);
  const rest = next.doneAt && endsRound && !timed ? Math.max(0, ...group.map(exerciseRest)) : 0;
  if (rest) {
    active.restFor = rest;
    active.restEndsAt = new Date(now.getTime() + rest * 1000).toISOString();
  } else if (!next.doneAt || group.length > 1 || timed) {
    active.restEndsAt = null;
  }
  save();
}

/** The rest after an exercise's sets: the one set for it in this workout, else the plan's, else ours (lib/workout `restSeconds`). */
export function exerciseRest(exercise: DraftExercise): number {
  const item = exerciseItem(exercise.exerciseId);
  return exercise.rest ?? exercise.target?.restSeconds ?? (item ? restSeconds(item) : 0);
}

/** Sets the rest after an exercise's sets for the rest of this workout. A rest already running keeps its length. */
export function setExerciseRest(key: string, seconds: number): void {
  const exercise = find(key);
  if (!exercise) return;
  exercise.rest = Math.max(0, Math.round(seconds));
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

/** Drops the workout in progress and hands it back, so Undo can bring it back whole. */
export function discardWorkout(): DraftWorkout | null {
  const dropped = workout.active;
  workout.active = null;
  save();
  return dropped;
}

/** Undo for Discard: the workout comes back as it was, unless another has started since. */
export function restoreWorkout(dropped: DraftWorkout): boolean {
  if (workout.active) return false;
  workout.active = dropped;
  save();
  return true;
}

/**
 * The time card: when the workout started, and when it ended (null: still going). The day follows the start.
 * Checked with `timesProblem` first.
 */
export function setWorkoutTimes(startedAt: string, endedAt: string | null): void {
  const active = workout.active;
  if (!active) {
    // Nothing has started yet: the first exercise starts it with these.
    Object.assign(quickTimes, { startedAt, endedAt, timesSet: true });
    return;
  }
  active.startedAt = startedAt;
  active.endedAt = endedAt;
  active.date = todayInZone(deviceTimeZone(), new Date(startedAt));
  active.timesSet = true;
  save();
}

/** After Settings → Reset data: the workout in progress and the unsent ones go too. */
export function forgetWorkouts(): void {
  workout.active = null;
  workout.pending = [];
  workout.summary = null;
  workout.past = null;
  save();
  writeJson(pendingKey(), workout.pending);
}

/**
 * Finishes the workout: sets not ticked off are left out, and it is sent. Offline it waits on the
 * phone and goes when the server answers. A refusal ("failed") keeps the workout open.
 */
export async function finishWorkout(now = new Date()): Promise<"saved" | "waiting" | "failed"> {
  const active = workout.active;
  if (!active) return "failed";
  // An end set on the time card is when it ended; otherwise it ends now.
  const done = finished(active, active.endedAt ? new Date(active.endedAt) : now);
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
    workout.bests = newBests(done.exercises, (id) => workout.previous[id]?.best);
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
  workout.bests = [];
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
