import type { WorkoutPart } from "./workout";

// Where a drag on the workout timeline lands (README, *Logging a workout*; docs/training.md, decision 15). The rules
// for what a drop may do are in lib/timelineMove.ts; this is the geometry: which gap the lifted rows are over, how
// far the other rows slide to open it, and which place in which exercise that gap is.

/** A row of the timeline as measured when the drag began: its top within the list, and its height. */
export interface Box {
  key: string;
  top: number;
  height: number;
}

/**
 * The gap the lifted rows are over, as the number of the other rows above it. Going up, their top edge passes the
 * middle of each row; going down, their bottom edge does, so a set with two drop sets (three rows tall) doesn't have
 * to go a row too far before the gap moves.
 */
export function landing(others: readonly Box[], top: number, dy: number, height: number): number {
  const edge = dy < 0 ? top + dy : top + dy + height;
  return others.filter((box) => box.top + box.height / 2 < edge).length;
}

/**
 * How far a row that isn't lifted is drawn from where it was: closed up behind the lifted rows (`height` tall, at
 * `unitTop` when the drag began), then pushed down past the gap at `gap` when one is open. `at` is its place among
 * the rows not lifted.
 */
export function shiftOf(box: Box, at: number, gap: number, unitTop: number, height: number, open: boolean): number {
  const after = box.top > unitTop;
  if (!open) return 0;
  return (after ? -height : 0) + (at >= gap ? height : 0);
}

/** A row beside the gap, as far as a set's place goes. */
export type Neighbour =
  | { type: "set"; exercise: string; index: number }
  | { type: "exercise"; exercise: string; sets: number; open: boolean }
  | { type: "other" };

/**
 * The place a gap between `above` and `below` is for the sets lifted (`start` to `end` of exercise `exercise`):
 * before the set below it, after the set above it, or after an exercise's heading (first in an open one, last in a
 * folded one). `at` counts the exercise's sets without the ones lifted. Elsewhere (by the start, a heading of a part)
 * there's no place.
 */
export function setPlace(
  above: Neighbour | undefined,
  below: Neighbour | undefined,
  unit: { exercise: string; start: number; end: number },
): { key: string; at: number } | null {
  const without = (key: string, index: number) => (key === unit.exercise && index >= unit.end ? index - (unit.end - unit.start) : index);
  if (above?.type === "set" && (below?.type !== "set" || below.exercise !== above.exercise)) {
    return { key: above.exercise, at: without(above.exercise, above.index + 1) };
  }
  if (below?.type === "set") return { key: below.exercise, at: without(below.exercise, below.index) };
  if (above?.type === "exercise") {
    const count = above.sets - (above.exercise === unit.exercise ? unit.end - unit.start : 0);
    return { key: above.exercise, at: above.open ? 0 : Math.max(0, count) };
  }
  return null;
}

/** A row beside the gap, as far as an exercise's place goes: a row of a run (by its first exercise), a part's
 * heading, or anything else (the start, a rest, the +). */
export type Slot =
  | { type: "run"; head: string; part: WorkoutPart | null }
  | { type: "part"; part: WorkoutPart | null }
  | { type: "other" };

/**
 * Where a lifted exercise (or a whole superset) goes, with every exercise folded to its heading: `rows` are the rows
 * not lifted, `gap` the landing among them. The gap moves out of a run to whichever end of it is nearer, and stays
 * after the start and before the + at the end. `at` counts the runs above it. Right under a part's heading it goes in
 * that part; right over one, in the part above; elsewhere `part` is left out and the rules take it from its
 * neighbours.
 */
export function exercisePlace(rows: readonly Slot[], gap: number): { gap: number; at: number; part?: WorkoutPart | null } {
  let at = gap;
  // Out of the middle of a run.
  for (let first = 0; first < rows.length; first++) {
    const row = rows[first];
    if (row.type !== "run") continue;
    let last = first;
    while (rows[last + 1]?.type === "run" && (rows[last + 1] as { head: string }).head === row.head) last++;
    if (at > first && at <= last) at = at - first <= last + 1 - at ? first : last + 1;
    first = last;
  }
  // After what leads (the start), before what trails (a rest, the +).
  let lo = 0;
  while (rows[lo]?.type === "other") lo++;
  let hi = rows.length;
  while (hi > lo && rows[hi - 1]?.type === "other") hi--;
  at = Math.max(lo, Math.min(hi, at));
  const heads = new Set<string>();
  let runPart: WorkoutPart | null | undefined;
  for (const row of rows.slice(0, at)) {
    if (row.type === "run") {
      heads.add(row.head);
      runPart = row.part;
    }
  }
  const under = rows[at - 1];
  const over = rows[at];
  const part = under?.type === "part" ? under.part : over?.type === "part" ? runPart : undefined;
  return part === undefined ? { gap: at, at: heads.size } : { gap: at, at: heads.size, part };
}

/** A run among the rows not lifted, where it's drawn: its rows' keys, its top and bottom, and its last row's place. */
export interface Block {
  index: number;
  keys: string[];
  top: number;
  bottom: number;
  last: number;
}

/** The runs among `rows` (the rows not lifted, `slots` saying what each is), drawn where `drawn` puts each. */
export function runBlocks(rows: readonly Box[], slots: readonly Slot[], drawn: (box: Box, at: number) => number): Block[] {
  const blocks: (Block & { head: string })[] = [];
  rows.forEach((box, at) => {
    const slot = slots[at];
    if (slot?.type !== "run") return;
    const top = drawn(box, at);
    const last = blocks[blocks.length - 1];
    if (last && last.head === slot.head && last.last === at - 1) {
      last.keys.push(box.key);
      last.bottom = top + box.height;
      last.last = at;
    } else {
      blocks.push({ index: blocks.length, head: slot.head, keys: [box.key], top, bottom: top + box.height, last: at });
    }
  });
  return blocks.map(({ head: _head, ...block }) => block);
}

/**
 * The run a lifted exercise would join: the one whose middle band its middle is over. A quarter of the run at each
 * end is left out (at least 14px, at most half), so the edges still move it between runs; every run has to be passed
 * through its middle, so each can be joined from above or below.
 */
export function joinAt(blocks: readonly Block[], middle: number): Block | null {
  for (const block of blocks) {
    const height = block.bottom - block.top;
    const inner = Math.min(height / 2, Math.max(14, height / 4));
    if (middle > block.top + inner && middle < block.bottom - inner) return block;
  }
  return null;
}
