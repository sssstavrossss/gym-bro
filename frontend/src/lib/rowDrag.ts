import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { dropIndex, rowShift, type RowBox } from "./reorder";

/**
 * Dragging rows of a list into a new order: by a handle at once, or by pressing and holding the row
 * (moving first is a scroll, so it lets go). The other rows slide aside to open the gap, and the move
 * applies on release. Used by the card pages and + button sheets.
 */
export interface RowDragOptions {
  list: Ref<HTMLElement | null>;
  /** The lines the drag moves past, in order: rows and any headings between them. */
  selector: string;
  /** Where the dragged line lands for a place among the others, or `from` when it can't go there. */
  land?: (from: number, to: number) => number;
  drop: (from: number, to: number) => void;
}

export function useRowDrag(options: RowDragOptions) {
  const drag = ref<{ from: number; to: number; dy: number; height: number } | null>(null);
  /** Just dropped: the lines take their new places without sliding back first. */
  const settling = ref(false);
  let boxes: RowBox[] = [];
  let startY = 0;
  let pointerId = -1;
  let held = false;
  let pressTimer = 0;
  let press: { x: number; y: number; index: number; id: number } | null = null;

  function measure() {
    boxes = [...(options.list.value?.querySelectorAll<HTMLElement>(options.selector) ?? [])].map((row) => ({ top: row.offsetTop, height: row.offsetHeight }));
  }
  function begin(index: number, y: number, id: number) {
    measure();
    startY = y;
    pointerId = id;
    drag.value = { from: index, to: index, dy: 0, height: boxes[index]?.height ?? 0 };
    options.list.value?.setPointerCapture?.(id);
  }
  function onGrip(event: PointerEvent, index: number) {
    if (event.button !== 0 || drag.value) return;
    event.preventDefault();
    begin(index, event.clientY, event.pointerId);
  }
  function onRowDown(event: PointerEvent, index: number) {
    if (event.button !== 0 || drag.value || (event.target as HTMLElement).closest("[data-grip]")) return;
    press = { x: event.clientX, y: event.clientY, index, id: event.pointerId };
    window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      if (!press) return;
      held = true;
      begin(press.index, press.y, press.id);
      navigator.vibrate?.(10);
    }, 400);
  }
  function onMove(event: PointerEvent) {
    if (press && !drag.value && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
      window.clearTimeout(pressTimer);
      press = null;
    }
    const current = drag.value;
    if (!current || event.pointerId !== pointerId) return;
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    const own = boxes[current.from];
    if (!first || !last || !own) return;
    // Kept within the list, so the row can't be dragged off the sheet.
    const dy = Math.max(first.top - own.top, Math.min(last.top + last.height - own.top - own.height, event.clientY - startY));
    const to = dropIndex(boxes, current.from, dy);
    drag.value = { ...current, dy, to: options.land ? options.land(current.from, to) : to };
  }
  async function onUp(event: PointerEvent) {
    window.clearTimeout(pressTimer);
    press = null;
    const current = drag.value;
    if (!current || event.pointerId !== pointerId) return;
    drag.value = null;
    pointerId = -1;
    // The click that ends a held press lands on the row's control: skip it, then allow taps again.
    window.setTimeout(() => { held = false; }, 0);
    if (current.to === current.from) return;
    settling.value = true;
    options.drop(current.from, current.to);
    await nextTick();
    requestAnimationFrame(() => { settling.value = false; });
  }
  function onCancel() {
    window.clearTimeout(pressTimer);
    press = null;
    drag.value = null;
    pointerId = -1;
    held = false;
  }
  function offset(index: number): number {
    const current = drag.value;
    if (!current) return 0;
    return index === current.from ? current.dy : rowShift(index, current.from, current.to, current.height);
  }
  /** True while a held press is ending: its click isn't a tap. */
  function wasHeld(): boolean {
    return held;
  }
  /** Stops the sheet scrolling while a held row is dragged on a touch screen. */
  function blockScroll(event: TouchEvent) {
    if (drag.value) event.preventDefault();
  }
  watch(options.list, (el, old) => {
    old?.removeEventListener("touchmove", blockScroll);
    el?.addEventListener("touchmove", blockScroll, { passive: false });
  });
  onBeforeUnmount(() => {
    options.list.value?.removeEventListener("touchmove", blockScroll);
    window.clearTimeout(pressTimer);
  });

  return { drag, settling, onGrip, onRowDown, onMove, onUp, onCancel, offset, wasHeld };
}
