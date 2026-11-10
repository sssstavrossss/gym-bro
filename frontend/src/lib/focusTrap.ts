import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]";

/** Where Tab should land. Null means the browser may move within the cycle. -1 means stay put. */
export function tabDestination(count: number, index: number, shift: boolean, inside: boolean): number | null {
  if (count <= 0) return -1;
  if (!inside || index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

export function focusableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.getAttribute("tabindex") === "-1" || el.getAttribute("aria-hidden") === "true") return false;
    if ((el as HTMLButtonElement).disabled) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  });
}

function cycle(dialog: HTMLElement): HTMLElement[] {
  const toast = [...document.querySelectorAll<HTMLElement>(".toast button")];
  const extra = toast.filter((el) => !dialog.contains(el) && focusableElements(el.parentElement ?? el).includes(el));
  return [...focusableElements(dialog), ...extra];
}

/**
 * While `open` is true, Tab stays in the dialog (and a toast action, so Undo remains reachable).
 * Focus returns to whatever opened it, unless another dialog is still on screen.
 */
export function useDialogFocus(open: () => boolean, root: Ref<HTMLElement | null>): () => void {
  let previous: HTMLElement | null = null;

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Tab" || !open()) return;
    const dialog = root.value;
    if (!dialog) return;
    const items = cycle(dialog);
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const next = tabDestination(items.length, index, event.shiftKey, index >= 0);
    if (next === null) return;
    event.preventDefault();
    if (next < 0) dialog.focus({ preventScroll: true });
    else items[next]?.focus({ preventScroll: true });
  }

  watch(open, (isOpen, wasOpen) => {
    if (!isOpen || wasOpen) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body || active === document.documentElement) return;
    if (active.closest("[role='dialog']")) return;
    previous = active;
  }, { flush: "sync" });

  watch(open, async (isOpen) => {
    if (isOpen) {
      await nextTick();
      const dialog = root.value;
      if (!dialog) return;
      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active)) dialog.focus({ preventScroll: true });
      window.addEventListener("keydown", onKey, true);
      return;
    }
    window.removeEventListener("keydown", onKey, true);
    await nextTick();
    restore();
  }, { flush: "post" });

  function restore() {
    const openDialog = [...document.querySelectorAll("[role='dialog']")].some((el) => (
      !el.classList.contains("sheet-leave-active")
      && !el.classList.contains("sheet-leave-to")
      && !el.classList.contains("fade-leave-active")
      && !el.classList.contains("fade-leave-to")
    ));
    if (openDialog) return;
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
  }

  onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
  return restore;
}
