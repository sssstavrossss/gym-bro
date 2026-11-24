import { int } from "./format";

/** How long the toast in front stays (4 s). The ones behind wait; their time starts when they come to the front. */
export const TOAST_LIFE = 4000;
/** At most this many show at once: the one in front and the edge of the next. The rest wait unseen. */
export const TOAST_SHOWN = 2;

export interface ToastAction {
  label: string;
  run: () => void;
}

/** Same-kind toasts that arrive back to back become one ("Added 2 foods · 237 kcal"), and one Undo covers them all. */
export interface ToastMerge {
  kind: "add" | "delete";
  count: number;
  kcal?: number;
}

export interface ToastSpec {
  text: string;
  action?: ToastAction;
  /** A failure: an alert icon, and screen readers hear it at once. */
  error?: boolean;
  merge?: ToastMerge;
}

export interface QueuedToast extends ToastSpec {
  id: number;
}

/** The words for merged toasts. */
export function mergedText(merge: ToastMerge): string {
  if (merge.kind === "delete") return `Deleted ${merge.count} items`;
  const what = merge.count === 1 ? "1 food" : `${merge.count} foods`;
  return merge.kcal != null ? `Added ${what} · ${int(merge.kcal)} kcal` : `Added ${what}`;
}

function both(first?: ToastAction, second?: ToastAction): ToastAction | undefined {
  if (!first || !second) return first ?? second;
  return { label: first.label, run: () => { first.run(); second.run(); } };
}

/**
 * Adds a toast to the end of the queue, or folds it into the last one when both are the same kind.
 * `restart` says the front toast is new or changed, so its 4 s start again.
 */
export function enqueue(queue: readonly QueuedToast[], spec: ToastSpec, id: number): { queue: QueuedToast[]; restart: boolean } {
  const last = queue.at(-1);
  if (last?.merge && spec.merge && last.merge.kind === spec.merge.kind && !last.error && !spec.error) {
    const merge: ToastMerge = {
      kind: last.merge.kind,
      count: last.merge.count + spec.merge.count,
      ...(last.merge.kcal != null || spec.merge.kcal != null ? { kcal: (last.merge.kcal ?? 0) + (spec.merge.kcal ?? 0) } : {}),
    };
    const action = both(last.action, spec.action);
    const folded: QueuedToast = { id: last.id, text: mergedText(merge), merge, ...(action ? { action } : {}) };
    return { queue: [...queue.slice(0, -1), folded], restart: queue.length === 1 };
  }
  return { queue: [...queue, { ...spec, id }], restart: queue.length === 0 };
}

/** The front toast's clock: only it counts down, and holding it pauses the count. */
export function frontTimer(life: number, onEnd: () => void) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let left = life;
  let startedAt = 0;
  let held = false;
  const run = () => {
    clearTimeout(handle);
    startedAt = Date.now();
    handle = setTimeout(onEnd, left);
  };
  return {
    /** A new front toast: a full 4 s, counting unless a finger is still on it. */
    start() {
      left = life;
      if (!held) run();
    },
    stop() {
      clearTimeout(handle);
      held = false;
      left = life;
    },
    pause() {
      if (held) return;
      held = true;
      clearTimeout(handle);
      left = Math.max(0, left - (Date.now() - startedAt));
    },
    resume() {
      if (!held) return;
      held = false;
      run();
    },
  };
}

/** Whether a drag ends in a throw: far enough, or a quick flick, in any direction. */
export function isThrow(dx: number, dy: number, ms: number): boolean {
  const distance = Math.hypot(dx, dy);
  return distance > 60 || (distance > 20 && distance / Math.max(ms, 1) > 0.5);
}
