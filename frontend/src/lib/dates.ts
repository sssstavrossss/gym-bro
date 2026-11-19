// Local calendar days as ISO strings "YYYY-MM-DD". Today is the real local date.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parse(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayIso(): string {
  return iso(new Date());
}

/** The civil date in an IANA zone, now or at another moment. Falls back to the browser's local date. */
export function todayInZone(timeZone: string, now = new Date()): string {
  try {
    const format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const date = format.format(now);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : iso(now);
  } catch {
    return iso(now);
  }
}
/** The wall-clock time in an IANA zone, "HH:MM". Falls back to the browser's local time. */
export function timeInZone(timeZone: string, now = new Date()): string {
  const local = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  try {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return /^\d{2}:\d{2}$/.test(time) ? time : local;
  } catch {
    return local;
  }
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
export const shortDate = (isoDate: string) => `${weekdayShort(isoDate)}, ${dayNum(isoDate)} ${MON3[parse(isoDate).getMonth()]}`;
export const dayMonth = (isoDate: string) => `${dayNum(isoDate)} ${MON3[parse(isoDate).getMonth()]}`;
export const longDate = (isoDate: string) => `${weekday(isoDate)}, ${dayNum(isoDate)} ${MONTHS[parse(isoDate).getMonth()]}`.toUpperCase();
export function spanLabel(a: string, b: string): string {
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${dayNum(a)} – ${dayMonth(b)}` : `${dayMonth(a)} – ${dayMonth(b)}`;
}
