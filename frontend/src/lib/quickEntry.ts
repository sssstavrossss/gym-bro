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

/** Keypad and typed editing for one quick-add number. The first new entry replaces; later keys append. */
export function nextQuickNumber(current: string, key: string, replace: boolean, maxInt: number): string {
  if (replace && key === "⌫") return typeDigits(current, "⌫", maxInt);
  if (replace && (key === "." || key === ",")) return "0.";
  return typeDigits(replace ? "" : current, key === "," ? "." : key, maxInt);
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

function typeDigits(current: string, key: string, maxInt: number): string {
  if (key === "⌫") return current.length <= 1 ? "" : current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  if (current.includes(".") && current.split(".")[1].length >= 1) return current;
  if (!current.includes(".") && current.replace(/^0/, "").length >= maxInt) return current;
  return current === "0" ? key : current + key;
}
