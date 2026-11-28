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
