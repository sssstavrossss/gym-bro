export interface Selection {
  selecting: boolean;
  selected: string[];
  anchor: string | null;
}

export const emptySelection = (): Selection => ({ selecting: false, selected: [], anchor: null });

export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/** Inclusive range from the anchor to this row, added to the current selection. */
export function rangeIds(ordered: readonly string[], anchor: string | null, id: string, selected: readonly string[]): string[] {
  const start = ordered.indexOf(anchor ?? id);
  const end = ordered.indexOf(id);
  if (start < 0 || end < 0) return toggleId(selected, id);
  const [lo, hi] = start < end ? [start, end] : [end, start];
  const next = [...selected];
  for (const item of ordered.slice(lo, hi + 1)) {
    if (!next.includes(item)) next.push(item);
  }
  return next;
}

/**
 * A click on the row. Modifiers start a selection; an open selection toggles.
 * Shift extends from the anchor. A plain click edits when nothing is selected.
 */
export function activateRow(
  state: Selection,
  ordered: readonly string[],
  id: string,
  mods: { shift: boolean; toggle: boolean },
): Selection | "edit" {
  if (mods.shift && (state.selecting || state.anchor)) {
    const selected = rangeIds(ordered, state.anchor, id, state.selecting ? state.selected : []);
    return { selecting: selected.length > 0, selected, anchor: id };
  }
  if (state.selecting) {
    const selected = toggleId(state.selected, id);
    return { selecting: selected.length > 0, selected, anchor: id };
  }
  if (mods.toggle || mods.shift) {
    return { selecting: true, selected: [id], anchor: id };
  }
  return "edit";
}

/** The circle next to a row. Shift still extends a range. */
export function activateMark(state: Selection, ordered: readonly string[], id: string, shift: boolean): Selection {
  if (shift && state.anchor) {
    const selected = rangeIds(ordered, state.anchor, id, state.selecting ? state.selected : []);
    return { selecting: selected.length > 0, selected, anchor: id };
  }
  const selected = state.selecting ? toggleId(state.selected, id) : [id];
  return { selecting: selected.length > 0, selected, anchor: id };
}

export function toggleGroup(selected: readonly string[], ids: readonly string[]): string[] {
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  if (all) return selected.filter((id) => !ids.includes(id));
  const next = [...selected];
  for (const id of ids) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

/** Hold still for this long on a touch pointer to start selecting. */
export const longPressMs = 480;

export function longPressMoved(dx: number, dy: number): boolean {
  return Math.abs(dx) > 8 || Math.abs(dy) > 8;
}

/** Where a horizontal drag rests: open once it passes the threshold, otherwise shut. */
export function settledSwipe(x: number, width: number): number {
  return x < -width / 2.5 ? -width : 0;
}
