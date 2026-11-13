const moveLimit = 10;

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Watch a press and pick when it lifts without having become a scroll.
 * Pointer down itself never selects. A drag past 10px, or a list that
 * scrolled, is left for the browser to scroll.
 */
export function bindPick(event: PointerEvent, pick: () => void): void {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const scroller = scrollParent(el);
  const startScroll = scroller?.scrollTop ?? 0;
  el.dataset.tapMoved = "0";
  el.dataset.picked = "";
  const move = (ev: PointerEvent) => {
    const dragged = Math.hypot(ev.clientX - startX, ev.clientY - startY) > moveLimit;
    const scrolled = Math.abs((scroller?.scrollTop ?? 0) - startScroll) > 2;
    if (dragged || scrolled) el.dataset.tapMoved = "1";
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
  const up = () => {
    stop();
    const scrolled = Math.abs((scroller?.scrollTop ?? 0) - startScroll) > 2;
    if (el.dataset.tapMoved === "1" || scrolled) return;
    el.dataset.picked = "1";
    pick();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/** Keyboard activation, and a click the pointer-up already handled. */
export function clickPick(event: MouseEvent, pick: () => void): void {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.picked === "1") {
    el.dataset.picked = "";
    return;
  }
  if (el.dataset.tapMoved === "1") return;
  pick();
}
