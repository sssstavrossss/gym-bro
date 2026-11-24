import { swipeAxis, swipeSpeed, type SwipeSample } from "./weekSwipe";

/** A pull this far past the first or last card wraps around. Shorter than a page turn: the card can't move, so there's nothing to drag. */
export const WRAP_DISTANCE = 32;
/** A flick this fast (px per ms) wraps after only WRAP_FLICK_DISTANCE px. */
export const WRAP_FLICK_SPEED = 0.25;
export const WRAP_FLICK_DISTANCE = 14;

/**
 * Whether a drag that started on an end card wraps around.
 * `edge` is the end card it started on. Returns the way to go: 1 for the next card (last → first),
 * -1 for the one before (first → last), 0 to stay.
 */
export function wrapTurn(edge: "first" | "last", dx: number, dy: number, samples: readonly SwipeSample[]): -1 | 0 | 1 {
  if (swipeAxis(dx, dy) !== "h") return 0;
  const way = edge === "last" ? -1 : 1;
  if (Math.sign(dx) !== way) return 0;
  const speed = swipeSpeed(samples);
  const far = Math.abs(dx) >= WRAP_DISTANCE;
  const flick = Math.abs(dx) >= WRAP_FLICK_DISTANCE && Math.abs(speed) >= WRAP_FLICK_SPEED && Math.sign(speed) === way;
  if (!far && !flick) return 0;
  return edge === "last" ? 1 : -1;
}

/** The short way round from one page to another: 1 → 4 of 4 is one step back, not three forward. */
export function shortTurn(from: number, to: number, count: number): number {
  if (count < 1) return 0;
  let delta = (((to - from) % count) + count) % count;
  if (delta > count / 2) delta -= count;
  return delta;
}
