/**
 * Dragging a row to a new place in a list. Rows can be different heights (a caption that wraps),
 * so the place comes from their midpoints, measured before the drag starts.
 */

export interface RowBox {
  top: number;
  height: number;
}

/** Where a row dragged `dy` px from its place lands: the number of other rows whose middle is above its middle. */
export function dropIndex(rows: readonly RowBox[], from: number, dy: number): number {
  const dragged = rows[from];
  if (!dragged) return from;
  const middle = dragged.top + dragged.height / 2 + dy;
  return rows.filter((row, index) => index !== from && row.top + row.height / 2 < middle).length;
}

/** How far the other rows slide to open the gap: the dragged row's height, up or down, for the rows it passed. */
export function rowShift(index: number, from: number, to: number, height: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -height;
  if (from > to && index >= to && index < from) return height;
  return 0;
}

/** A row's place after a keyboard step: one up or down, kept in the list. */
export function stepIndex(from: number, step: number, count: number): number {
  return Math.max(0, Math.min(count - 1, from + step));
}
