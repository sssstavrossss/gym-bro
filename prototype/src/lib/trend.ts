// S8 / decision 34 (Part A): the weight trend is always on.
// One deterministic daily loop from the first weigh-in to `end`:
//  - a day with a real weigh-in, or a gap reading, moves the trend 10 % of the way (decision 17);
//  - a gap of 2–28 days between weigh-ins gets straight-line gap readings on every day of the gap;
//  - a gap of more than 28 days is a fresh start: the trend becomes the new weigh-in exactly.
// Part A has no intake step, so a day without a reading keeps yesterday's trend.
import { addDays, diffDays } from "./dates";

export const TREND_ALPHA = 0.1;
export const GAP_MAX_DAYS = 28;
/** Low accuracy: fewer than this many real weigh-ins in the last 7 days */
export const LOW_ACC_MIN = 2;
/** Typo guard: ask before saving a weigh-in more than this far from the previous day's trend */
export const TYPO_KG = 3.0;

export interface TrendResult {
  /** trend per day, from the first weigh-in to `end` */
  series: Record<string, number>;
  /** weigh-in days that started fresh (previous weigh-in more than 28 days before) */
  fresh: string[];
  /** days inside a fresh-start gap (no line is drawn there) */
  gapDays: Set<string>;
}

export function trendSeries(weights: Record<string, number>, end: string): TrendResult {
  const ds = Object.keys(weights).filter((d) => d <= end).sort();
  const series: Record<string, number> = {};
  const fresh: string[] = [];
  const gapDays = new Set<string>();
  if (!ds.length) return { series, fresh, gapDays };
  const reading: Record<string, number> = { [ds[0]]: weights[ds[0]] };
  const freshSet = new Set<string>();
  for (let i = 1; i < ds.length; i++) {
    const p = ds[i - 1], d = ds[i], gap = diffDays(d, p);
    if (gap > GAP_MAX_DAYS) {
      freshSet.add(d); fresh.push(d);
      for (let k = 1; k < gap; k++) gapDays.add(addDays(p, k));
      continue;
    }
    for (let k = 1; k <= gap; k++) reading[addDays(p, k)] = weights[p] + ((weights[d] - weights[p]) * k) / gap;
  }
  let t = weights[ds[0]];
  series[ds[0]] = t;
  for (let d = addDays(ds[0], 1); d <= end; d = addDays(d, 1)) {
    if (freshSet.has(d)) t = weights[d];
    else if (reading[d] !== undefined) t += TREND_ALPHA * (reading[d] - t);
    series[d] = t;
  }
  return { series, fresh, gapDays };
}

/** Trend on `date` from the weigh-ins known up to that date (a snapshot, e.g. for a target row). */
export function trendAsOf(weights: Record<string, number>, date: string): number | null {
  return trendSeries(weights, date).series[date] ?? null;
}

/** Real weigh-ins in the 7 days ending on `date`. */
export const weighInsIn7 = (weights: Record<string, number>, date: string) =>
  Object.keys(weights).filter((d) => d <= date && diffDays(date, d) < 7).length;

export type TrendState = "none" | "normal" | "low_accuracy" | "fresh_start";
export type TrendReason = "few_weigh_ins" | "fresh_start";

/** trendState + reasons, as the API will return them (S8 display states, Part A). */
export function trendStatus(weights: Record<string, number>, date: string): { state: TrendState; reasons: TrendReason[]; n7: number; freshGapDays: number | null } {
  const ds = Object.keys(weights).filter((d) => d <= date).sort();
  if (!ds.length) return { state: "none", reasons: [], n7: 0, freshGapDays: null };
  const n7 = weighInsIn7(weights, date);
  const last = ds[ds.length - 1], prev = ds[ds.length - 2];
  const gap = prev ? diffDays(last, prev) : null;
  const reasons: TrendReason[] = [];
  const isFresh = gap != null && gap > GAP_MAX_DAYS;
  if (isFresh) reasons.push("fresh_start");
  if (n7 < LOW_ACC_MIN) reasons.push("few_weigh_ins");
  return { state: isFresh ? "fresh_start" : reasons.length ? "low_accuracy" : "normal", reasons, n7, freshGapDays: isFresh ? gap : null };
}

/** Typo guard (Q5): the previous day's trend, without the weigh-in being entered/edited. null = first weigh-in → no guard. */
export function typoCheck(weights: Record<string, number>, date: string, kg: number): { ask: boolean; ref: number | null; diff: number } {
  const others = { ...weights };
  delete others[date];
  const ref = trendAsOf(others, addDays(date, -1));
  if (ref == null) return { ask: false, ref: null, diff: 0 };
  const diff = kg - ref;
  return { ask: Math.abs(diff) > TYPO_KG + 1e-9, ref, diff };
}

/** "6 weeks", or "over 4 weeks" for 29–34 days */
export const gapLabel = (days: number) => (days < 35 ? "over 4 weeks" : `${Math.floor(days / 7)} weeks`);
