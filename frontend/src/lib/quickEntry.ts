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
  text = text.replace(/[^0-9.]/g, "");
  const dot = text.indexOf(".");
  if (dot >= 0) text = `${text.slice(0, dot + 1)}${text.slice(dot + 1).replace(/\./g, "")}`;
  if (replace && previous && text !== previous) {
    if (text.startsWith(previous)) text = text.slice(previous.length);
    else if (text.endsWith(previous) && text.length > previous.length) text = text.slice(0, text.length - previous.length);
  }
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
