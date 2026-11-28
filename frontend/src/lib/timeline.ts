// The workout as a timeline (README, *Logging a workout*; docs/training.md, decisions 12 and 14), drawn like a git
// graph: a rail down the left with a node for each event (the start, each exercise, each set, the rest between sets,
// the end of a superset) and the rows beside it: numbers only, everything else is on the rail and its menus. The rail is solid up to where the workout is now and dotted ahead, where it is
// still the plan. A superset of two branches into a second lane and merges back; a circuit of three or more stays on
// one lane with its exercises lettered. An exercise, or a superset, folds to its heading and opens in place.
// This file lays it out; components/WorkoutTimeline.vue measures where the nodes landed and draws the rail.

import { exerciseGroups, partHeading, type DraftExercise, type DraftSet, type SetField } from "./workout";

export type RowState = "done" | "now" | "next";
export type Lane = 0 | 1;

interface RowBase {
  key: string;
  lane: Lane;
  state: RowState;
}

export type TimelineRow = RowBase & (
  | { type: "start" }
  /** "Warm-up", "Workout", "Cool-down": a heading between parts, with no node. */
  | { type: "part"; label: string; part: string }
  /** A superset, circuit or clocked block's heading (and its clock), where the lanes split. */
  | { type: "run"; head: string; size: number }
  | { type: "exercise"; exercise: string; head: string; letter: string | null; open: boolean }
  | { type: "set"; exercise: string; index: number }
  /**
   * The rest between a set and the next one (in a superset, between rounds), after `exercise`'s set `index`. Done:
   * `seconds` from one tick to the next (null when the next set came without one). Ahead: the rest planned.
   */
  | { type: "pause"; exercise: string; index: number; seconds: number | null }
  /** The rest running, on the rail just before the set it leads to, in place of its pause. */
  | { type: "rest" }
  | { type: "merge"; head: string }
  | { type: "add" }
);

export interface TimelineInput {
  exercises: readonly DraftExercise[];
  /** Whether a run (by its first exercise's key) is open; `current` is the run the next set to do is in. */
  isOpen: (head: string, current: boolean) => boolean;
  /** The live workout has a next set to do; a past one doesn't. */
  live: boolean;
  started: boolean;
  /** A rest is running (or just ran out), so it shows on the rail. */
  resting: boolean;
}

/** A run's sets in the order they are done: one set of each exercise a round, A1, B1, A2, B2. */
export function roundOrder(run: readonly DraftExercise[]): { exercise: DraftExercise; index: number }[] {
  const rounds = Math.max(0, ...run.map((exercise) => exercise.sets.length));
  const out: { exercise: DraftExercise; index: number }[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const exercise of run) if (round < exercise.sets.length) out.push({ exercise, index: round });
  }
  return out;
}

/** The set to do next in the live workout: the first not ticked off, in the order sets are done. */
export function nextSet(exercises: readonly DraftExercise[]): { key: string; index: number } | null {
  for (const run of exerciseGroups(exercises)) {
    const next = roundOrder(run).find(({ exercise, index }) => !exercise.sets[index].doneAt);
    if (next) return { key: next.exercise.key, index: next.index };
  }
  return null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const isDone = (exercise: DraftExercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.doneAt);
const anyDone = (exercise: DraftExercise) => exercise.sets.some((set) => set.doneAt);

/** Every row of the timeline, in order, each on its lane and marked done, now (the way to the next set) or next. */
export function timelineRows(input: TimelineInput): TimelineRow[] {
  const runs = exerciseGroups(input.exercises);
  const now = input.live ? nextSet(input.exercises) : null;
  const rows: TimelineRow[] = [{ key: "start", type: "start", lane: 0, state: input.started ? "done" : "next" }];
  let restShown = false;

  runs.forEach((run, at) => {
    const heading = partHeading(runs, at);
    if (heading) rows.push({ key: `part:${run[0].key}`, type: "part", lane: 0, state: "next", label: heading, part: run[0].part ?? "main" });
    const head = run[0].key;
    const current = !!now && run.some((exercise) => exercise.key === now.key);
    const open = input.isOpen(head, current);
    const multi = run.length > 1;
    // Two exercises take a lane each; a circuit of three or more stays on one, lettered.
    const laneOf = (k: number): Lane => (run.length === 2 && k === 1 ? 1 : 0);
    const letterOf = (k: number) => (multi ? LETTERS[k] ?? null : null);
    const started = run.some(anyDone);
    if (multi || run[0].timed) {
      rows.push({ key: `run:${head}`, type: "run", lane: 0, state: started ? "done" : current ? "now" : "next", head, size: run.length });
    }
    const exerciseRow = (exercise: DraftExercise, k: number): TimelineRow => ({
      key: `ex:${exercise.key}`, type: "exercise", lane: laneOf(k), exercise: exercise.key, head, letter: letterOf(k), open,
      // A past workout has no "now": an exercise with a set ticked off is done.
      state: isDone(exercise) ? "done" : !input.live ? (anyDone(exercise) ? "done" : "next") : current || anyDone(exercise) ? "now" : "next",
    });
    // Rests between sets in the live workout; a clocked block keeps its own clock, a past workout its sets only.
    const pauses = input.live && !run[0].timed;
    let before: { exercise: DraftExercise; index: number } | null = null;
    const setRows = (exercise: DraftExercise, index: number, lane: Lane) => {
      const isNow = !!now && now.key === exercise.key && now.index === index;
      const between = before && (run.length === 1 || before.index !== index) ? before : null;
      before = { exercise, index };
      if (isNow && input.resting) {
        rows.push({ key: "rest", type: "rest", lane, state: "now" });
        restShown = true;
      } else if (between && pauses) {
        const from = between.exercise.sets[between.index].doneAt;
        const to = exercise.sets[index].doneAt;
        const seconds = from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null;
        rows.push({
          key: `pause:${between.exercise.key}:${between.index}`, type: "pause", lane: lane === 1 ? 0 : lane,
          state: from ? "done" : "next", exercise: between.exercise.key, index: between.index, seconds: Number.isNaN(seconds) ? null : seconds,
        });
      }
      rows.push({
        key: `set:${exercise.key}:${index}`, type: "set", lane, exercise: exercise.key, index,
        state: exercise.sets[index].doneAt ? "done" : isNow ? "now" : "next",
      });
    };

    if (!multi) {
      const exercise = run[0];
      rows.push(exerciseRow(exercise, 0));
      if (open) exercise.sets.forEach((_, index) => setRows(exercise, index, 0));
      return;
    }
    run.forEach((exercise, k) => rows.push(exerciseRow(exercise, k)));
    if (open) for (const { exercise, index } of roundOrder(run)) setRows(exercise, index, laneOf(run.indexOf(exercise)));
    rows.push({ key: `merge:${head}`, type: "merge", lane: 0, state: run.every(isDone) ? "done" : "next", head });
  });

  // A rest whose next set is folded away (or after the last set) waits at the end.
  if (input.resting && !restShown) rows.push({ key: "rest", type: "rest", lane: 0, state: "now" });
  rows.push({ key: "add", type: "add", lane: 0, state: "next" });
  return rows;
}

/** The rows with a node on the rail: all but the headings between parts. */
export function hasNode(row: TimelineRow): boolean {
  return row.type !== "part";
}

export interface TimelineEdge {
  from: string;
  to: string;
  fromLane: Lane;
  toLane: Lane;
  /** Solid up to where the workout is, dotted ahead; the rest running fills its stretch as it goes. */
  kind: "done" | "next" | "rest";
}

/**
 * The rail between the nodes: each node joins the one before on its lane. The second lane leaves from the superset's
 * heading, and the merge takes both lanes back. A stretch is solid when it leads to a node that is done or on the way
 * to the next set.
 */
export function timelineEdges(rows: readonly TimelineRow[]): TimelineEdge[] {
  const edges: TimelineEdge[] = [];
  const last: (TimelineRow | null)[] = [null, null];
  let split: TimelineRow | null = null;
  const join = (from: TimelineRow, to: TimelineRow) => {
    edges.push({ from: from.key, to: to.key, fromLane: from.lane, toLane: to.lane, kind: from.type === "rest" ? "rest" : to.state === "next" ? "next" : "done" });
  };
  for (const row of rows) {
    if (!hasNode(row)) continue;
    if (row.type === "run") split = row;
    if (row.type === "merge") {
      if (last[0]) join(last[0], row);
      if (last[1]) join(last[1], row);
      last[0] = row;
      last[1] = null;
      split = null;
      continue;
    }
    const parent = row.lane === 1 ? last[1] ?? split : last[0];
    if (parent) join(parent, row);
    last[row.lane] = row;
  }
  return edges;
}

/** A set's field as the timeline shows it, number and unit apart: "62.5" kg, "1:30", "1.5" km. */
export function fieldParts(field: SetField, value: number | null): { n: string; unit: string } {
  if (value == null) return { n: "—", unit: field === "seconds" ? "" : FIELD_UNITS[field] };
  const plain = (n: number) => String(Math.round(n * 100) / 100);
  switch (field) {
    case "seconds": {
      const s = Math.max(0, Math.round(value));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, "0");
      return { n: h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`, unit: "" };
    }
    case "metres":
      return value >= 1000 ? { n: plain(Math.round(value / 10) / 100), unit: "km" } : { n: plain(value), unit: "m" };
    default:
      return { n: plain(value), unit: FIELD_UNITS[field] };
  }
}
const FIELD_UNITS: Record<SetField, string> = { kg: "kg", reps: "reps", rir: "RIR", seconds: "", metres: "m" };
/** The scoreboard's caption over each number. */
export const FIELD_CAPTIONS: Record<SetField, string> = { kg: "kg", reps: "Reps", rir: "RIR", seconds: "Time", metres: "Distance" };

/**
 * A number picked for a set carries on to the later sets not done yet, the ones still showing the old number (or none),
 * so changing the next set's weight changes the rest of the plan with it, up to one changed by hand. Only sets of the
 * same kind: a warm-up's weight never reaches the working sets.
 */
export function carryOn(sets: readonly DraftSet[], index: number, field: SetField, before: number | null): number[] {
  const out: number[] = [];
  const type = sets[index]?.type;
  for (let k = index + 1; k < sets.length; k++) {
    const set = sets[k];
    // Warm-ups and working sets keep their own numbers.
    if (set.doneAt || set.type !== type) continue;
    if (set[field] != null && set[field] !== before) break;
    out.push(k);
  }
  return out;
}
