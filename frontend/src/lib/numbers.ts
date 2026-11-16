/** Accepts "83.4" and "83,4". Returns null when the text is not a plain decimal. */
export function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function atMostOneDecimal(value: number): boolean {
  return Math.abs(Math.round(value * 10) - value * 10) < 1e-6;
}

export function formatMeasure(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function sameNumber(raw: string, value: number): boolean {
  const parsed = parseDecimal(raw);
  return parsed !== null && Math.abs(parsed - value) < 1e-6;
}

/** One keypad press into a number typed as text: digits, "." and "⌫". Caps whole digits (a leading 0 does not count) and decimals. */
export function typeInto(current: string, key: string, maxInt: number, decimals = 1): string {
  if (key === "⌫") return current.length <= 1 ? "" : current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  if (current.includes(".") && current.split(".")[1].length >= decimals) return current;
  if (!current.includes(".") && current.replace(/^0/, "").length >= maxInt) return current;
  return current === "0" ? key : current + key;
}

/** One tenth up or down from a weight in the shown unit, kept inside the allowed range. */
export function nudgeTenth(value: number, step: -1 | 1, min: number, max: number): number {
  const next = Math.round(value * 10 + step) / 10;
  return Math.min(max, Math.max(min, next));
}
