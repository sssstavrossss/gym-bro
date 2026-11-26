import { swipeAxis } from "./weekSwipe";

/**
 * Home's suggestions (fresh start, recalculate, weigh in, goal reached) stack like the toasts:
 * one in front, the edge of the next behind it. A sideways swipe sends the front one to the back,
 * so they go round and round. Nothing times out. ✕ on a card still dismisses it.
 */
export interface StackPlaces {
  front: string | null;
  back: string | null;
  /** Shown but out of sight behind the back one. Focusing into one brings it to the front. */
  rest: string[];
}

/**
 * Where each shown card sits. `order` is the fixed order of all the cards and `shown` the ones on
 * screen. The front card stays in front while it shows. When it goes (dismissed or done),
 * the next one after it in the order comes forward, wrapping to the first.
 */
export function stackPlaces(order: readonly string[], shown: ReadonlySet<string>, front: string | null): StackPlaces {
  const visible = order.filter((key) => shown.has(key));
  if (!visible.length) return { front: null, back: null, rest: [] };
  const first = frontFor(order, shown, front) ?? visible[0];
  const at = visible.indexOf(first);
  const behind = [...visible.slice(at + 1), ...visible.slice(0, at)];
  return { front: first, back: behind[0] ?? null, rest: behind.slice(1) };
}

/** The card that should be in front: `front` while it shows, else the next shown one after it in the order. */
export function frontFor(order: readonly string[], shown: ReadonlySet<string>, front: string | null): string | null {
  if (front && shown.has(front)) return front;
  const start = front ? order.indexOf(front) : -1;
  for (let step = 1; step <= order.length; step++) {
    const key = order[(start + step + order.length) % order.length];
    if (shown.has(key)) return key;
  }
  return null;
}

/** The card that comes forward when the front one is swiped away: the next shown one, wrapping round. */
export function nextFront(order: readonly string[], shown: ReadonlySet<string>, front: string | null): string | null {
  const now = frontFor(order, shown, front);
  if (!now) return null;
  const start = order.indexOf(now);
  for (let step = 1; step <= order.length; step++) {
    const key = order[(start + step) % order.length];
    if (shown.has(key)) return key;
  }
  return now;
}

/**
 * A sideways throw that sends the front card to the back: past 80px, or a quick flick past 24px.
 * An up or down drag is the page scrolling, so it never counts. Returns the side it leaves by.
 */
export function stackThrow(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (swipeAxis(dx, dy) !== "h") return 0;
  const distance = Math.abs(dx);
  const quick = distance > 24 && distance / Math.max(ms, 1) > 0.5;
  if (distance <= 80 && !quick) return 0;
  return dx < 0 ? -1 : 1;
}
