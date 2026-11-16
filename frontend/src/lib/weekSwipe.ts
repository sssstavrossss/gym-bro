/** Recent pointer position, for flick speed. */
export interface SwipeSample { t: number; x: number }

/** Drag past this (px, capped at 18% of the strip) and letting go turns the week. */
export const SWIPE_DISTANCE = 56;
/** A flick this fast (px per ms) turns the week after only FLICK_DISTANCE px. */
export const FLICK_SPEED = 0.3;
export const FLICK_DISTANCE = 24;

/** Horizontal speed over the samples, in px per ms. */
export function swipeSpeed(samples: readonly SwipeSample[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const time = last.t - first.t;
  return time > 0 ? (last.x - first.x) / time : 0;
}

/** -1 for the week before, 1 for the week after, 0 to spring back. A long drag or a quick flick both turn. */
export function swipeTurn(dx: number, speed: number, width: number): -1 | 0 | 1 {
  const far = Math.abs(dx) > Math.min(SWIPE_DISTANCE, width * 0.18);
  const flick = Math.abs(dx) > FLICK_DISTANCE && Math.abs(speed) > FLICK_SPEED && Math.sign(speed) === Math.sign(dx);
  if (!far && !flick) return 0;
  return dx > 0 ? -1 : 1;
}

/** Which way a fresh drag goes. Leans sideways: up to about 50 degrees off flat still turns the week. */
export function swipeAxis(dx: number, dy: number): "none" | "h" | "v" {
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return "none";
  return Math.abs(dx) >= Math.abs(dy) * 0.8 ? "h" : "v";
}
