/**
 * Read the field after the current insertion finishes.
 * WebKit can deliver one character per input event inside a single insert, and a
 * Vue render between those events drops the rest. Waiting a microtask lets the
 * whole insertion land before the value is written back.
 */
/** A fill or paste that had the whole value selected should be kept as typed. */
export function markWholeSelection(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  input.dataset.whole = input.value.length > 0 && start === 0 && end === input.value.length ? "1" : "";
}

export function tookWholeSelection(input: HTMLInputElement): boolean {
  const whole = input.dataset.whole === "1";
  input.dataset.whole = "";
  return whole;
}

export function afterInsertion(input: HTMLInputElement, apply: (raw: string) => void): void {
  const token = String(Number(input.dataset.settle || "0") + 1);
  input.dataset.settle = token;
  queueMicrotask(() => {
    if (input.dataset.settle !== token) return;
    apply(input.value);
  });
}

/**
 * A typed field. When `replace` is set, a character added onto the old value
 * (caret at either end) is the new entry. A selection that already replaced
 * the old value is kept as typed.
 */
export function nextQuickInput(previous: string, raw: string, replace: boolean, maxLen: number): string {
  let text = raw.replace(/,/g, ".");
  // Drop the old value before stripping a second decimal. "84.038.6" is 38.6 typed onto 84.0.
  if (replace && previous && text !== previous) {
    if (text.startsWith(previous)) text = text.slice(previous.length);
    else if (text.endsWith(previous) && text.length > previous.length) text = text.slice(0, text.length - previous.length);
  }
  text = text.replace(/[^0-9.]/g, "");
  const dot = text.indexOf(".");
  if (dot >= 0) text = `${text.slice(0, dot + 1)}${text.slice(dot + 1).replace(/\./g, "")}`;
  if (text === ".") text = "0.";
  return text.slice(0, maxLen);
}
