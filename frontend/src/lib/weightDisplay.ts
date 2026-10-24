import type { WeightChartPoint, WeightResponse } from "../api";
import { diffDays } from "./dates";
import { kg, signed } from "./format";
import { zeroWeighInsDotCopy } from "./partADecisions";

/** "6 weeks", or "over 4 weeks" for a 29–34 day gap. Matches the prototype. */
export function gapLabel(days: number): string {
  return days < 35 ? "over 4 weeks" : `${Math.floor(days / 7)} weeks`;
}

export function isLowAccuracy(weight: WeightResponse | null): boolean {
  if (weight?.trendKg == null) return false;
  return weight.trendState === "low_accuracy"
    || weight.weighInsInWindow < 2
    || weight.reasons.includes("fewer_than_2_weighins_7d");
}

export function isFreshStart(weight: WeightResponse | null): boolean {
  return weight?.trendState === "fresh_start";
}

/** Profile row: "trend · low accuracy". */
export function profileTrendLabel(weight: WeightResponse | null): string {
  if (weight?.trendKg == null) return "Weight";
  if (isLowAccuracy(weight)) return "trend · low accuracy";
  if (isFreshStart(weight)) return "trend · fresh start";
  return "trend";
}

/**
 * One line under the trend. At the default size it stays one line; large text wraps it.
 * A fresh start hides the week change. Low accuracy replaces it.
 */
export function weightSubtitle(
  latestKg: number | null,
  fresh: boolean,
  low: boolean,
  weekKg: number | null,
): string {
  const latest = latestKg != null ? `latest ${kg(latestKg)}` : "";
  const tail = fresh ? "fresh start" : low ? "low accuracy" : weekKg != null ? `${signed(weekKg)} kg/wk` : "";
  return [latest, tail].filter(Boolean).join(" · ");
}

/** This week / 30 days. A fresh start is not comparable, so both are blank. */
export function trendChange(series: WeightChartPoint[] | null | undefined, daysBack: number, fresh: boolean): number | null {
  if (fresh || !series || series.length <= daysBack) return null;
  const end = series[series.length - 1]?.trendKg;
  const prev = series[series.length - 1 - daysBack]?.trendKg;
  if (end == null || prev == null) return null;
  return end - prev;
}

export function accuracyCopy(weight: WeightResponse | null): { short: string; lines: string[] } {
  if (!weight) return { short: "", lines: [] };
  const lines: string[] = [];
  let short = "";
  const freshDays = weight.trendState === "fresh_start" ? weight.freshStart?.daysSincePrevious ?? null : null;
  if (freshDays != null) {
    const label = gapLabel(freshDays);
    const restarted = weight.latestKg != null ? ` from ${kg(weight.latestKg)} kg` : "";
    lines.push(`Fresh start: it had been ${label} since your last weigh-in, so the trend restarted${restarted}.`);
    short = `fresh start after ${label}`;
  }
  if (weight.weighInsInWindow < 2) {
    if (weight.weighInsInWindow === 1) {
      lines.push("Only 1 weigh-in this week, so the trend is less accurate. Weighing in 2+ times a week helps.");
      short ||= "only 1 weigh-in this week";
    } else {
      const ago = weight.latestDate ? diffDays(weight.asOf, weight.latestDate) : null;
      const zero = zeroWeighInsDotCopy(ago);
      lines.push(zero.line);
      short ||= zero.short;
    }
  }
  return { short, lines };
}
