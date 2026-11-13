/**
 * Focus a field and select its whole value so the next keystroke replaces it.
 *
 * iOS Safari only raises the keyboard when focus() runs in the same synchronous
 * turn as the tap. A sheet's input does not exist until Vue renders, which is
 * after that turn. The opener calls `primeKeyboard()` inside the tap: that
 * focuses a 16px proxy input that is always in the page, so the keyboard
 * opens. When the real field mounts, `focusField` moves focus onto it and
 * selects the value. Moving focus between inputs keeps the keyboard up.
 * Desktop and a mouse do the same focus and select, without the proxy.
 * The dialog focus trap then lands on `[data-autofocus]` instead of the
 * dialog element, and does not move focus if it is already inside the dialog.
 */

export interface FocusableField {
  focus: (options?: { preventScroll?: boolean }) => void;
  value?: string;
  disabled?: boolean;
  setSelectionRange?: (start: number, end: number) => void;
}

export const autofocusSelector = "[data-autofocus]";

export function selectField(el: FocusableField | null | undefined): void {
  if (!el || typeof el.setSelectionRange !== "function") return;
  const length = el.value?.length ?? 0;
  try {
    el.setSelectionRange(0, length);
  } catch {
    // date, time, and some other types reject a selection range.
  }
}

/**
 * Numeric fields replace the current value on the first key, without painting
 * a selection. The caret sits at the end and `data-replace-first` stays set
 * until that first input is applied.
 */
export function armReplace(el: HTMLInputElement | null | undefined): void {
  if (!el) return;
  el.dataset.replaceFirst = "1";
  el.dataset.replaceValue = el.value;
  const length = el.value.length;
  try {
    el.setSelectionRange(length, length);
  } catch {
    // Some input types reject a caret range.
  }
}

export function focusField(el: FocusableField | null | undefined): boolean {
  if (!el || el.disabled) return false;
  el.focus({ preventScroll: true });
  if (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement && el.dataset.replace === "1") armReplace(el);
  else selectField(el);
  return true;
}

let proxy: FocusableField | null = null;
let opener: HTMLElement | null = null;

export function bindFocusProxy(el: FocusableField | null): void {
  proxy = el;
}

export function focusProxy(): FocusableField | null {
  return proxy;
}

/** True while the tap's proxy still holds focus, so a later field can take the keyboard over. */
export function keyboardHolding(): boolean {
  return proxy != null && typeof document !== "undefined" && document.activeElement === (proxy as unknown as Node);
}

/** The control that opened the sheet, recorded before the proxy took focus. */
export function takeOpener(): HTMLElement | null {
  const el = opener;
  opener = null;
  return el;
}

/**
 * Call this inside the tap, click, or keydown that opens a form, before any await.
 * Focusing the proxy in that same turn is what lets iOS Safari raise the keyboard.
 * The real field then takes focus when it mounts.
 */
export function primeKeyboard(): void {
  if (typeof document !== "undefined") {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== (proxy as unknown as Node) && !active.closest("[role='dialog']")) opener = active;
  }
  proxy?.focus({ preventScroll: true });
}

export function primaryField(root: ParentNode): HTMLElement | null {
  const marked = [...root.querySelectorAll<HTMLElement>(autofocusSelector)];
  for (const el of marked) {
    if (isFocusable(el)) return el;
  }
  const inputs = root.querySelectorAll<HTMLElement>("input, textarea, select");
  for (const el of inputs) {
    if (isFocusable(el)) return el;
  }
  return null;
}

function isFocusable(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true" || el.dataset.noAutofocus != null) return false;
  const type = el.getAttribute("type");
  if (type === "hidden" || type === "checkbox" || type === "radio" || type === "button") return false;
  if ((el as HTMLInputElement).disabled) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}
