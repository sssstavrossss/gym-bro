import { addDays, diffDays } from "./dates";
import { metGoal, type GoalKind } from "./progressCard";

// The Home Progress card moves through time a day at a time: an overview strip of your history under the chart, with
// the days in view boxed, and a hold-then-drag on the chart. The card loads a year (or All) once and slices each
// window out of it here, so moving is instant.

/** Days in each fixed range (6m is 182 days, as on the server). All has no length: it is the whole history. */
export const RANGE_DAYS: Record<string, number | undefined> = { "7d": 7, "30d": 30, "90d": 90, "6m": 182 };

/** The fixed ranges look back a year at most (the server's 1y). All has everything. */
export const LOOKBACK_DAYS = 365;

/** The strip's drawn height, in its own units (one per px). */
export const STRIP_HEIGHT = 36;

/** Days the chart shows: the range, or your whole history when that is shorter (and always for All). */
export function windowLength(range: string, history: number): number {
  const have = Math.max(1, history);
  const length = RANGE_DAYS[range];
  return length == null ? have : Math.min(length, have);
}

/** Days the strip covers: your history, up to a year for the fixed ranges. Never shorter than the window. */
export function stripSpan(range: string, history: number): number {
  const have = Math.max(1, history);
  return RANGE_DAYS[range] == null ? have : Math.min(LOOKBACK_DAYS, have);
}

/** Whole days the window can move back before it reaches the strip's first day. */
export function maxOffset(span: number, length: number): number {
  return Math.max(0, span - length);
}

export function clampOffset(offset: number, span: number, length: number): number {
  return Math.max(0, Math.min(maxOffset(span, length), Math.round(offset)));
}

/** The `length` days ending `offset` days before the last one (oldest first, ending today). */
export function windowOf<T>(days: readonly T[], length: number, offset: number): T[] {
  const end = Math.max(0, days.length - offset);
  return days.slice(Math.max(0, end - length), end);
}

/** The window's box on the strip, in % of the strip. A window as long as the strip fills it. */
export function boxOf(span: number, length: number, offset: number): { left: number; width: number } {
  if (span <= length) return { left: 0, width: 100 };
  return { left: ((span - offset - length) / span) * 100, width: (length / span) * 100 };
}

/** Days back from today to the window's middle, or null at now (which stays at now when the range changes). */
export function centreOf(offset: number, length: number): number | null {
  return offset === 0 ? null : offset + (length - 1) / 2;
}

/** The offset that keeps a middle (from centreOf) in view at another length. */
export function offsetForCentre(centre: number | null, span: number, length: number): number {
  return centre == null ? 0 : clampOffset(centre - (length - 1) / 2, span, length);
}

/** The offset that puts the window's middle on `day`, counted in days from the strip's left end (fractional). */
export function offsetAtStripDay(day: number, span: number, length: number): number {
  return clampOffset(span - (day + length / 2), span, length);
}

/** The day under x on a plot `width` px wide that shows `count` days. */
export function dayIndexAt(x: number, width: number, count: number): number {
  if (count <= 0 || width <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((x / width) * count)));
}

export interface StripBar { x: number; w: number; h: number; off: boolean }

/** The strip in miniature, in a viewBox `span` days wide and STRIP_HEIGHT tall. */
export interface StripShape {
  /** A line, broken where there is no value (before your first weigh-in, or a fresh-start gap). */
  line: string;
  /** Its band (value ± spread), one closed shape per unbroken stretch. */
  band: string;
  /** A bar a week: the average of its logged days. A bar a day is a blur at this size. */
  bars: StripBar[];
  /** The week's line (target, minimum or limit), dashed across each bar's week. */
  target: string;
  /** Days that start a month, for faint separators. */
  months: number[];
}

const EMPTY: Omit<StripShape, "months"> = { line: "", band: "", bars: [], target: "" };

/** Indexes of days that start a month (not the first day). */
export function monthStarts(dates: readonly string[]): number[] {
  return dates.flatMap((date, index) => (index > 0 && date.endsWith("-01") ? [index] : []));
}

const fixed = (value: number) => Number(value.toFixed(2));

/** A line in its band for the weight trend or the burn: each day's value and spread, null where there is none. */
export function lineStrip(dates: readonly string[], points: readonly { value: number | null; spread: number | null }[], height = STRIP_HEIGHT): StripShape {
  const months = monthStarts(dates);
  const have = points.flatMap((point, index) => (point.value == null ? [] : [{ index, value: point.value, spread: point.spread ?? 0 }]));
  if (!have.length) return { ...EMPTY, months };
  const lo = Math.min(...have.map((p) => p.value - p.spread));
  const hi = Math.max(...have.map((p) => p.value + p.spread));
  const pad = (hi - lo) * 0.08 || 1;
  const y = (value: number) => fixed(height - 2 - ((value - lo + pad) / (hi - lo + 2 * pad)) * (height - 4));
  const runs: (typeof have)[] = [];
  have.forEach((point, i) => {
    if (i === 0 || point.index !== have[i - 1].index + 1) runs.push([]);
    runs[runs.length - 1].push(point);
  });
  const line = runs.map((run) => `M${run.map((p) => `${p.index + 0.5},${y(p.value)}`).join("L")}`).join("");
  const band = runs
    .filter((run) => run.some((p) => p.spread > 0))
    .map((run) => {
      const top = run.map((p) => `${p.index + 0.5},${y(p.value + p.spread)}`);
      const bottom = [...run].reverse().map((p) => `${p.index + 0.5},${y(p.value - p.spread)}`);
      return `M${[...top, ...bottom].join("L")}Z`;
    })
    .join("");
  return { line, band, bars: [], target: "", months };
}

/** A bar a week for an intake page, ending today, with the week's line. A bar off its line is drawn fainter. */
export function weekBarStrip(days: readonly { date: string; logged: boolean; value: number | null; target: number | null }[], kind: GoalKind, height = STRIP_HEIGHT): StripShape {
  const months = monthStarts(days.map((day) => day.date));
  const weeks: { start: number; length: number; average: number | null; target: number | null }[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    const week = days.slice(start, end);
    const logged = week.flatMap((day) => (day.logged && day.value != null ? [day.value] : []));
    const lines = week.flatMap((day) => (day.target != null ? [day.target] : []));
    weeks.unshift({
      start,
      length: end - start,
      average: logged.length ? logged.reduce((sum, value) => sum + value, 0) / logged.length : null,
      target: lines.length ? lines[lines.length - 1] : null,
    });
  }
  const top = Math.max(1, ...weeks.map((week) => (week.average ?? 0) * 1.05), ...weeks.map((week) => (week.target ?? 0) * 1.45));
  const h = (value: number) => fixed((value / top) * (height - 3));
  const bars = weeks.flatMap((week) => (week.average == null || week.length < 3 ? [] : [{
    x: week.start + 1,
    w: week.length - 2,
    h: h(week.average),
    off: week.target != null && !metGoal(week.average, week.target, kind),
  }]));
  const target = weeks
    .filter((week) => week.target != null)
    .map((week) => `M${week.start},${fixed(height - h(week.target!))}H${week.start + week.length}`)
    .join("");
  return { line: "", band: "", bars, target, months };
}

export interface WeighInRow { date: string; kg: number }

/** Weigh-ins this far apart start a new trend (the server's fresh start). */
export const FRESH_START_GAP_DAYS = 28;
export const RATE_MIN_WEIGH_INS = 4;
export const RATE_MIN_SPAN_DAYS = 14;

/**
 * The rate as the server works it out, for a window ending on `end`: how far the trend moved over the 14 days up to the
 * last weigh-in on or before `end`, per week. Needs 4 weigh-ins since the last fresh start, spread over 14 days.
 * `trendOn` gives a day's published trend (2 decimals).
 */
export function rateAt(weighIns: readonly WeighInRow[], trendOn: (date: string) => number | null | undefined, end: string): number | null {
  const upTo = [...new Set(weighIns.filter((row) => row.date <= end).map((row) => row.date))].sort();
  if (!upTo.length) return null;
  let first = upTo.length - 1;
  while (first > 0 && diffDays(upTo[first], upTo[first - 1]) <= FRESH_START_GAP_DAYS) first--;
  const last = upTo[upTo.length - 1];
  const from = addDays(last, -RATE_MIN_SPAN_DAYS);
  if (upTo.length - first < RATE_MIN_WEIGH_INS || from < upTo[first]) return null;
  const now = trendOn(last);
  const then = trendOn(from);
  if (now == null || then == null) return null;
  // In hundredths, so half a hundredth rounds away from zero as the server's decimals do.
  const diff = Math.round(now * 100) - Math.round(then * 100);
  return (Math.sign(diff) * Math.round(Math.abs(diff) / 2)) / 100 || 0;
}

export interface TrendDayRow { date: string; trendKg: number | null; trendBandKg?: number | null }

export interface WeightWindow {
  trendKg: number | null;
  bandKg: number | null;
  latestKg: number | null;
  count: number;
  rateKgPerWeek: number | null;
}

/**
 * The weight stats for the days from `from` to `end`, read off the whole series: the trend on the window's last day
 * with one, the latest weigh-in up to then, the weigh-ins in the window, and the rate up to then.
 */
export function weightWindow(series: readonly TrendDayRow[], weighIns: readonly WeighInRow[], from: string, end: string): WeightWindow {
  const byDate = new Map(series.map((day) => [day.date, day]));
  let shown: TrendDayRow | null = null;
  for (const day of series) {
    if (day.date < from || day.date > end) continue;
    if (day.trendKg != null) shown = day;
  }
  const upTo = weighIns.filter((row) => row.date <= end);
  return {
    trendKg: shown?.trendKg ?? null,
    bandKg: shown?.trendBandKg ?? null,
    latestKg: upTo.length ? upTo[upTo.length - 1].kg : null,
    count: new Set(upTo.filter((row) => row.date >= from).map((row) => row.date)).size,
    rateKgPerWeek: rateAt(weighIns, (date) => byDate.get(date)?.trendKg, end),
  };
}
