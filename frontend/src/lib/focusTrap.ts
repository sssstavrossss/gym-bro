import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";
import { focusField, focusProxy, keyboardHolding, primaryField, takeOpener } from "./focusField";

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

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function cycle(dialog: HTMLElement): HTMLElement[] {
  const toast = [...document.querySelectorAll<HTMLElement>(".toast button")];
  const extra = toast.filter((el) => !dialog.contains(el) && focusableElements(el.parentElement ?? el).includes(el));
  return [...focusableElements(dialog), ...extra];
}

/** Open dialogs, oldest first. A dialog opened over another one (the card pages sheet) is last. */
const stack: HTMLElement[] = [];

/** Dialogs on screen that are not on their way out. */
function shownDialogs(): Element[] {
  return [...document.querySelectorAll("[role='dialog']")].filter((el) => (
    !el.classList.contains("sheet-leave-active")
    && !el.classList.contains("sheet-leave-to")
    && !el.classList.contains("fade-leave-active")
    && !el.classList.contains("fade-leave-to")
  ));
}

/**
 * While `open` is true, Tab stays in the dialog (and a toast action, so Undo remains reachable).
 * Only the top dialog keeps Tab, so one opened over another doesn't fight it.
 * Focus returns to whatever opened it: a button on the page once no dialog is left,
 * or a button inside a dialog that is still open under this one.
 */
export function useDialogFocus(open: () => boolean, root: Ref<HTMLElement | null>): () => void {
  let previous: HTMLElement | null = null;
  /** This dialog's element while it is on the stack. */
  let stacked: HTMLElement | null = null;

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Tab" || !open()) return;
    const dialog = root.value;
    if (!dialog || stack[stack.length - 1] !== dialog) return;
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
    const primed = takeOpener();
    if (primed) {
      previous = primed;
      return;
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body || active === document.documentElement || active === focusProxy()) return;
    previous = active;
  }, { flush: "sync" });

  watch(open, async (isOpen) => {
    if (isOpen) {
      await nextTick();
      const dialog = root.value;
      if (!dialog) return;
      unstack();
      stacked = dialog;
      stack.push(dialog);
      const active = document.activeElement;
      const alreadyInside = active instanceof Node && dialog.contains(active) && active !== dialog;
      if (!alreadyInside) {
        const primary = primaryField(dialog);
        if (primary) focusField(primary);
        else if (!keyboardHolding()) dialog.focus({ preventScroll: true });
      } else if (isTextField(active)) {
        focusField(active);
      }
      window.addEventListener("keydown", onKey, true);
      return;
    }
    window.removeEventListener("keydown", onKey, true);
    unstack();
    await nextTick();
    restore();
  }, { flush: "post" });

  function unstack() {
    const index = stacked ? stack.indexOf(stacked) : -1;
    if (index >= 0) stack.splice(index, 1);
    stacked = null;
  }

  function restore() {
    const target = previous;
    if (!target || !document.contains(target)) return;
    const shown = shownDialogs();
    const under = target.closest("[role='dialog']");
    // Back to a cog inside the sheet this one covered; otherwise only once no dialog is left.
    if (under ? shown.includes(under) : shown.length === 0) target.focus({ preventScroll: true });
  }

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKey, true);
    unstack();
  });
  return restore;
}
