// Moving sets and exercises on the workout timeline by dragging (docs/training.md, decision 15, draft). Pure rules:
// what a drag may do, what it changes, and whether it asks first. The timeline only shows the answer.
//
// The principle: the past is fixed, the plan ahead is yours to rearrange. Done sets and started exercises keep the
// order they were done in, because the rests between them, the tick times and the rail all read that order as time.
// Sets come in blocks: an exercise's warm-ups lead it, and a working set carries the drop sets that follow it.
// A block moves whole; inside one, its sets can be reordered. A move that changes what something *is* (a set's type,
// which exercise it counts for, a superset, a part of the workout) asks first; a plain reorder just happens, with Undo.

import type { ExerciseMeasure } from "./exercises";
import { apart, canJoin, exerciseGroups, samePart, withoutExercise, type DraftExercise, type DraftSet, type WorkoutPart } from "./workout";

/** A question the drop asks before it's done: what will happen, and the button that does it. */
export interface MoveAsk {
  title: string;
  body: string;
  /** The button that does it ("Move", "Make it a warm-up", "Superset"). */
  action: string;
  /** A second way to drop it there, when there is one: "Just move it here" instead of joining a superset. */
  alternative?: { action: string; exercises: DraftExercise[] };
}

export type MoveVerdict =
  | { ok: true; exercises: DraftExercise[]; ask: MoveAsk | null }
  | { ok: false; reason: string };

export interface MoveContext {
  /** The exercise's name, for the questions and reasons. */
  nameOf: (exerciseId: string) => string;
  measureOf: (exerciseId: string) => ExerciseMeasure;
}

// ---------------------------------------------------------------- Sets

/** The sets a drag picks up from set `index`: a warm-up or drop set alone, a working set with its drop sets. */
export function setUnit(sets: readonly DraftSet[], index: number): { start: number; end: number } {
  if (sets[index]?.type !== "working") return { start: index, end: index + 1 };
  let end = index + 1;
  while (sets[end]?.type === "drop") end++;
  return { start: index, end };
}

/** How many sets lead the exercise as warm-ups. */
export function warmupCount(sets: readonly DraftSet[]): number {
  let n = 0;
  while (sets[n]?.type === "warmup") n++;
  return n;
}

const anyDone = (sets: readonly DraftSet[]) => sets.some((set) => set.doneAt);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "80 kg × 10", "45 s", for the questions. */
function setLabel(set: DraftSet): string {
  if (set.kg != null && set.reps != null) return `${set.kg} kg × ${set.reps}`;
  if (set.kg != null) return `${set.kg} kg`;
  if (set.reps != null) return `${set.reps} reps`;
  if (set.seconds != null) return `${set.seconds} s`;
  if (set.metres != null) return `${set.metres} m`;
  return set.type === "warmup" ? "the warm-up" : set.type === "drop" ? "the drop set" : "the set";
}

function unitLabel(unit: readonly DraftSet[]): string {
  const drops = unit.filter((set) => set.type === "drop").length;
  return drops ? `${setLabel(unit[0])} and its ${plural(drops, "drop set")}` : setLabel(unit[0]);
}

function timedRun(exercises: readonly DraftExercise[], key: string): boolean {
  return exerciseGroups(exercises).some((run) => !!run[0].timed && run.some((exercise) => exercise.key === key));
}

/**
 * Moving the sets picked up at `from` to sit before set `at` of exercise `to` (in its list without them; its length
 * for the end). Within one exercise or into another.
 */
export function moveSet(
  exercises: readonly DraftExercise[],
  from: { key: string; index: number },
  to: { key: string; at: number },
  context: MoveContext,
): MoveVerdict {
  const source = exercises.find((exercise) => exercise.key === from.key);
  const target = exercises.find((exercise) => exercise.key === to.key);
  if (!source || !target || !source.sets[from.index]) return { ok: false, reason: "That set isn't there any more." };
  if (timedRun(exercises, source.key) || timedRun(exercises, target.key)) {
    return { ok: false, reason: "Sets on a clock (EMOM, AMRAP, for time) stay in their rounds." };
  }

  const { start, end } = setUnit(source.sets, from.index);
  const unit = source.sets.slice(start, end);
  const kind = unit[0].type;
  const same = source.key === target.key;
  const rest = same ? [...source.sets.slice(0, start), ...source.sets.slice(end)] : [...target.sets];
  const at = Math.max(0, Math.min(rest.length, to.at));
  if (same && at === start) return { ok: true, exercises: [...exercises], ask: null };
  // Done sets keep the order they were done in (see below): that's the first thing to say about moving one.
  const done = anyDone(unit);
  if (same && done) return { ok: false, reason: "Sets you've done stay in the order you did them." };

  if (!same && context.measureOf(source.exerciseId) !== context.measureOf(target.exerciseId)) {
    return { ok: false, reason: `${context.nameOf(target.exerciseId)} is logged differently, so the set can't go there.` };
  }

  // A drop set stays with the working set it drops from.
  if (kind === "drop") {
    if (!same) return { ok: false, reason: "A drop set stays with the set it drops from. Make it a working set to move it on its own." };
    let parent = start - 1;
    while (parent >= 0 && rest[parent]?.type === "drop") parent--;
    let chainEnd = parent + 1;
    while (rest[chainEnd]?.type === "drop") chainEnd++;
    if (parent < 0 || at <= parent || at > chainEnd) {
      return { ok: false, reason: "A drop set stays with the set it drops from. Make it a working set to move it on its own." };
    }
  }

  // Nothing lands inside another set's drop sets. (A done set goes in by time, so where it's dropped doesn't matter.)
  if (kind !== "drop" && !done && rest[at]?.type === "drop") return { ok: false, reason: "That's inside a set and its drop sets." };

  // Where it lands: among the warm-ups or among the working sets. On the line between them it stays what it was.
  const warmups = warmupCount(rest);
  const intoWarmups = kind === "warmup" ? at <= warmups : at < warmups;
  const becomes: DraftSet["type"] = kind === "drop" ? "drop" : intoWarmups ? "warmup" : kind === "warmup" ? "working" : kind;
  if (becomes === "warmup" && unit.length > 1) {
    return { ok: false, reason: "A set with drop sets can't be a warm-up. Move it without them first." };
  }

  // Done sets keep the order they were done in: they don't move among their own exercise's sets, and nothing
  // goes above them. Into another exercise, they go in by the time they were done.
  const region = (index: number) => (index < warmups ? "warmup" : "work");
  const landing = becomes === "warmup" ? "warmup" : "work";
  if (!done && rest.some((set, index) => index >= at && set.doneAt && region(index) === landing)) {
    return { ok: false, reason: "Sets you've done stay first, in the order you did them." };
  }
  let place = at;
  if (done) {
    // By time, among the target's sets of the same kind, after its warm-ups when it's a working set.
    const doneAt = Date.parse(unit[0].doneAt ?? "");
    const lo = landing === "warmup" ? 0 : warmups;
    const hi = landing === "warmup" ? warmups : rest.length;
    place = lo;
    for (let index = lo; index < hi; index++) {
      const other = rest[index];
      if (other.doneAt && Date.parse(other.doneAt) <= doneAt) place = index + 1;
      while (rest[place]?.type === "drop") place++;
    }
  }

  const moved = unit.map((set, index) => (index === 0 ? { ...set, type: becomes } : set));
  const placed = [...rest.slice(0, place), ...moved, ...rest.slice(place)];
  let result: DraftExercise[];
  let emptied = false;
  if (same) {
    result = exercises.map((exercise) => (exercise.key === source.key ? { ...exercise, sets: placed } : exercise));
  } else {
    const left = [...source.sets.slice(0, start), ...source.sets.slice(end)];
    emptied = left.length === 0;
    result = exercises.map((exercise) =>
      exercise.key === source.key ? { ...exercise, sets: left } : exercise.key === target.key ? { ...exercise, sets: placed } : exercise);
    if (emptied) result = withoutKey(result, source.key);
  }

  const asks: string[] = [];
  let title = "";
  let action = "Move";
  if (!same) {
    const name = context.nameOf(target.exerciseId);
    title = `Move ${unitLabel(unit)} to ${name}?`;
    asks.push(done
      ? `It counts for ${name} from now on: its bests, the weight suggested next time, and this week's sets.`
      : `It's done as part of ${name}.`);
    if (done) asks.push("It goes in by the time you did it.");
  }
  if (becomes !== kind) {
    if (!title) {
      title = becomes === "warmup" ? `Make ${setLabel(unit[0])} a warm-up?` : `Make ${setLabel(unit[0])} a working set?`;
      action = becomes === "warmup" ? "Make it a warm-up" : "Make it a working set";
    }
    asks.push(becomes === "warmup"
      ? "Warm-ups don't count toward your sets, volume or bests."
      : "It counts toward your sets, volume and bests.");
  }
  if (emptied) asks.push(`${context.nameOf(source.exerciseId)} has no sets left, so it comes off the workout.`);
  return { ok: true, exercises: result, ask: asks.length ? { title, body: asks.join(" "), action } : null };
}

/** Takes an exercise out, keeping a superset it led together (as `withoutExercise` does). */
function withoutKey(exercises: readonly DraftExercise[], key: string): DraftExercise[] {
  const at = exercises.findIndex((exercise) => exercise.key === key);
  return at < 0 ? [...exercises] : apart(withoutExercise(exercises, at).exercises);
}

// ---------------------------------------------------------------- Exercises

/** A run on the timeline: one exercise, or a superset or circuit done together, by the keys of its exercises. */
export interface RunPlace {
  keys: string[];
  started: boolean;
  part: WorkoutPart | null;
}

export function runPlaces(exercises: readonly DraftExercise[]): RunPlace[] {
  return exerciseGroups(exercises).map((run) => ({
    keys: run.map((exercise) => exercise.key),
    started: run.some((exercise) => anyDone(exercise.sets)),
    part: run[0].part ?? null,
  }));
}

const PART_NAMES: Record<WorkoutPart | "main", string> = { warmup: "the warm-up", main: "the workout", cooldown: "the cool-down" };

/** Lays runs back out as the exercise list: each run's first exercise starts it, the others join it. */
function flatten(runs: readonly DraftExercise[][]): DraftExercise[] {
  // A run left with an exercise next to itself (taken out from between them) splits there.
  return apart(runs.flatMap((run) => run.map((exercise, index) => {
    if (index === 0) {
      const { superset: _joined, ...rest } = exercise;
      return rest;
    }
    return { ...exercise, superset: true, timed: null };
  })));
}

/**
 * Moving exercise `key` (with its whole run when `whole`, else alone, out of its superset) to sit before run `at`
 * (counted without it; the number of runs for the end), or onto run `at` to be done together with it (`join`).
 * `part` is the heading it was dropped under (or over) on the screen, when it was dropped next to one: between the
 * last exercise of the workout and the first of the cool-down is two places, either side of the COOL-DOWN line.
 */
export function moveExercise(
  exercises: readonly DraftExercise[],
  move: { key: string; whole: boolean; at: number; join?: boolean; part?: WorkoutPart | null },
  context: MoveContext,
): MoveVerdict {
  const runs = exerciseGroups(exercises).map((run) => [...run]);
  const from = runs.findIndex((run) => run.some((exercise) => exercise.key === move.key));
  if (from < 0) return { ok: false, reason: "That exercise isn't there any more." };
  const fromRun = runs[from];
  const single = fromRun.length === 1;
  const whole = move.whole || single;
  const unit = whole ? fromRun : fromRun.filter((exercise) => exercise.key === move.key);
  const name = context.nameOf(unit[0].exerciseId);
  if (unit.some((exercise) => anyDone(exercise.sets))) {
    return { ok: false, reason: "Exercises you've started stay in the order you did them." };
  }
  if (!whole && fromRun[0].timed) return { ok: false, reason: "Exercises on a clock move with their whole block." };

  // The runs left once it's picked up; a superset it leaves stays together.
  const left = runs.map((run, index) => (index !== from ? run : whole ? [] : run.filter((exercise) => exercise.key !== move.key)));
  if (!whole && left[from].length && fromRun[0].key === move.key) {
    left[from] = left[from].map((exercise, index) => (index === 0 ? { ...exercise, timed: fromRun[0].timed ?? null } : exercise));
  }
  const others = left.filter((run) => run.length);
  const at = Math.max(0, Math.min(others.length - (move.join ? 1 : 0), move.at));
  // Dropped back where it was, it stays as it was, unless it was dropped on the other side of a heading.
  const samePlace = move.part === undefined || move.part === (unit[0].part ?? null);
  if (whole && !move.join && at === from && samePlace) return { ok: true, exercises: [...exercises], ask: null };
  const lastStarted = others.reduce((last, run, index) => (run.some((exercise) => anyDone(exercise.sets)) ? index : last), -1);

  if (move.join) {
    const target = others[at];
    if (!target) return { ok: false, reason: "There's nothing there to join." };
    if (target.some((exercise) => anyDone(exercise.sets))) {
      return { ok: false, reason: "An exercise you've started can't join a superset: its done sets would be paired with sets you haven't done." };
    }
    if (target[0].timed) return { ok: false, reason: "That block is on a clock. Add exercises to it from its menu." };
    if (!unit.every((exercise) => samePart(exercise, target[0]))) {
      return { ok: false, reason: "A superset stays within the warm-up, the workout or the cool-down." };
    }
    const joined = [...target, ...unit];
    if (joined.some((exercise, index) => index > 0 && !canJoin(joined[index - 1], exercise))) {
      return { ok: false, reason: `${name} can't be done together with itself.` };
    }
    const runsAfter = [...others.slice(0, at), joined, ...others.slice(at + 1)];
    const after = [...others.slice(0, at + 1), unit, ...others.slice(at + 1)];
    const names = target.map((exercise) => context.nameOf(exercise.exerciseId));
    const size = joined.length;
    return {
      ok: true,
      exercises: flatten(runsAfter),
      ask: {
        title: size > 2 ? `Make a circuit of ${names.join(", ")} and ${name}?` : `Superset ${name} with ${names[0]}?`,
        body: `You do one set of each, then rest. ${size > 2 ? "A circuit of three or more stays on one line, lettered." : ""}`.trim(),
        action: size > 2 ? "Make a circuit" : "Superset",
        alternative: { action: "Just move it here", exercises: flatten(after) },
      },
    };
  }

  if (at <= lastStarted) {
    return { ok: false, reason: "The exercises you've done stay first. What's ahead can go in any order." };
  }
  const placed = [...others.slice(0, at), unit, ...others.slice(at)];
  // Its part: the one above where it lands (below, at the top), kept when it's on the line between its own and another.
  const before = at > 0 ? others[at - 1][0].part ?? null : undefined;
  const next = at < others.length ? others[at][0].part ?? null : undefined;
  const own = unit[0].part ?? null;
  const landing = move.part !== undefined && (move.part === before || move.part === next)
    ? move.part
    : own === before || own === next ? own : before !== undefined ? before : (next ?? null);
  const hasParts = exercises.some((exercise) => exercise.part);
  const partChanged = hasParts && landing !== own;
  const result = flatten(placed.map((run) => (run === unit ? run.map((exercise) => withPart(exercise, partChanged ? landing : own)) : run)));

  const asks: string[] = [];
  let title = "";
  let action = "Move";
  if (!whole) {
    title = `Take ${name} out of the ${fromRun.length > 2 ? "circuit" : "superset"}?`;
    action = "Take it out";
    asks.push("It's done on its own, with its own rest.");
  }
  if (partChanged) {
    if (!title) title = `Move ${name} to ${PART_NAMES[landing ?? "main"]}?`;
    asks.push(landing === "cooldown" ? "It's done after the workout." : landing === "warmup" ? "It's done before the workout." : "It's part of the workout itself.");
  }
  return { ok: true, exercises: result, ask: asks.length ? { title, body: asks.join(" "), action } : null };
}

function withPart(exercise: DraftExercise, part: WorkoutPart | null): DraftExercise {
  const { part: _old, ...rest } = exercise;
  return part ? { ...rest, part } : rest;
}
