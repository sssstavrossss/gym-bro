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
