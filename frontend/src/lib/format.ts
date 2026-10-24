const residue = 1e-8;

/** Pull a binary residue (800.4999999999999) onto the nearest 1e-8. */
function snap(value: number): number {
  return Math.round(value / residue) * residue;
}

/**
 * Half away from zero, to `digits` places. Matches decimal.Round AwayFromZero.
 * The snap keeps a float that lands just under a midpoint (80.05) on that midpoint.
 */
export function roundHalfAwayFromZero(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const factor = 10 ** digits;
  const scaled = snap(Math.abs(value) * factor);
  const whole = Math.floor(scaled);
  const fraction = snap(scaled - whole);
  const away = fraction >= 0.5 ? whole + 1 : whole;
  const rounded = away / factor;
  return negative ? -rounded : rounded;
}

/** Fixed-point text for a value already rounded with roundHalfAwayFromZero. */
export function formatDecimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** digits;
  const magnitude = roundHalfAwayFromZero(Math.abs(value), digits);
  const scaled = Math.round(snap(magnitude * factor));
  const whole = Math.trunc(scaled / factor);
  const body = digits <= 0
    ? String(whole)
    : `${whole}.${String(scaled % factor).padStart(digits, "0")}`;
  return value < 0 && scaled !== 0 ? `-${body}` : body;
}

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Kilograms and trend, one decimal unless digits says otherwise. */
export const kg = (n: number, digits = 1) => formatDecimal(n, digits);

/** Profile goal weight. Whole numbers stay bare; midpoints use roundHalfAwayFromZero. */
export function formatGoalWeight(value: number): string {
  const rounded = roundHalfAwayFromZero(value);
  return Number.isInteger(rounded) ? String(rounded) : formatDecimal(rounded);
}

export function signed(n: number, digits = 1): string {
  const text = formatDecimal(n, digits);
  if (!text.startsWith("-")) return roundHalfAwayFromZero(n, digits) === 0 ? text : `+${text}`;
  return `−${text.slice(1)}`;
}

/** The sentence under “Is N kg right?”. Same rounding as the API error. */
export function typoGuardDetail(kgValue: number, previousTrendKg: number): string {
  const diff = kgValue - previousTrendKg;
  const way = diff < 0 ? "below" : "above";
  return `That's ${kg(Math.abs(diff))} kg ${way} your trend (${kg(previousTrendKg)} kg). Nothing is saved until you choose.`;
}

export function typoGuardSentence(kgValue: number, previousTrendKg: number): string {
  return `Is ${kg(kgValue)} kg right? ${typoGuardDetail(kgValue, previousTrendKg)}`;
}
