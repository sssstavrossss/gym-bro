// All dates are local calendar days as ISO strings "YYYY-MM-DD".
// The prototype runs on a fixed demo "today" so the example data always lines up with the Figma reference.
export const DEMO_TODAY = "2026-10-24";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(isoDate: string, n: number): string {
  const d = parse(isoDate);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
}
export function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
/** Monday of the week containing the date. */
export function weekStart(isoDate: string): string {
  const d = parse(isoDate);
  const dow = (d.getDay() + 6) % 7;
  return addDays(isoDate, -dow);
}
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return iso(d).slice(0, 7);
}
export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export const dayNum = (isoDate: string) => parse(isoDate).getDate();
export const weekday = (isoDate: string) => DAYS[parse(isoDate).getDay()];
export const weekdayShort = (isoDate: string) => DAYS[parse(isoDate).getDay()].slice(0, 3);
export const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
/** "Sat, 24 Oct" */
export const shortDate = (isoDate: string) => `${weekdayShort(isoDate)}, ${dayNum(isoDate)} ${MON3[parse(isoDate).getMonth()]}`;
/** "24 Oct" */
export const dayMonth = (isoDate: string) => `${dayNum(isoDate)} ${MON3[parse(isoDate).getMonth()]}`;
/** "SATURDAY, 24 OCTOBER" */
export const longDate = (isoDate: string) => `${weekday(isoDate)}, ${dayNum(isoDate)} ${MONTHS[parse(isoDate).getMonth()]}`.toUpperCase();
/** "28 Sep – 4 Oct" or "5 – 11 Oct" */
export function spanLabel(a: string, b: string): string {
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${dayNum(a)} – ${dayMonth(b)}` : `${dayMonth(a)} – ${dayMonth(b)}`;
}
