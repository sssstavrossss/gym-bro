import type { IntakeDay } from "./progressChart";

/**
 * Home Progress card: one page per metric, swiped like the Macros card.
 * Pure helpers for the chart sizes, the target steps, and each page's numbers.
 */

export const PROGRESS_PAGES = ["weight", "kcal", "protein", "fat", "carbs", "fiber", "saturatedFat", "sodium", "burn"] as const;
export type ProgressPage = (typeof PROGRESS_PAGES)[number];
/** Pages drawn as bars of what was eaten against a line. Weight and Burn are lines of their own. */
export type IntakePage = Exclude<ProgressPage, "weight" | "burn">;

export const PAGE_TITLES: Record<ProgressPage, string> = {
  weight: "Weight",
  kcal: "Calories",
  protein: "Protein",
  fat: "Fat",
  carbs: "Carbs",
  fiber: "Fibre",
  saturatedFat: "Saturated fat",
  sodium: "Sodium",
  burn: "Burn",
};

/**
 * What a page's line means. A target is to land near (within 10%), a minimum to reach,
 * and a limit to stay at or under.
 */
export type GoalKind = "target" | "minimum" | "limit";

/** The word before the line's number: "target 2,200", "min 35 g", "limit 25 g". */
export const LINE_WORDS: Record<GoalKind, string> = { target: "target", minimum: "min", limit: "limit" };

export function goalKind(page: IntakePage | "weight"): GoalKind {
  if (page === "protein" || page === "fiber") return "minimum";
  if (page === "saturatedFat" || page === "sodium") return "limit";
  return "target";
}

/** Whether a logged day met its line. A day without a line or a value never counts. */
export function metGoal(value: number | null, line: number | null, kind: GoalKind): boolean {
  if (line == null || value == null) return false;
  if (kind === "minimum") return value >= line;
  if (kind === "limit") return value <= line;
  return Math.abs(value - line) <= line * 0.1;
}

/** How many days fit the card's width before the chart scrolls. "All" uses the 6-month scale. */
export const WINDOW_DAYS = 183;

export interface ChartLayout {
  /** Width of the drawn chart in px. Wider than the view only when it scrolls. */
  contentWidth: number;
  scrollable: boolean;
}

export function chartLayout(range: string, dayCount: number, viewWidth: number): ChartLayout {
  if (range !== "all" || dayCount <= WINDOW_DAYS || viewWidth <= 0) return { contentWidth: Math.max(0, viewWidth), scrollable: false };
  return { contentWidth: Math.round((viewWidth * dayCount) / WINDOW_DAYS), scrollable: true };
}

/** Bars thin out as the range grows: 10 px at most, 1 px at least, about 60% of a day's slot. */
export function barWidth(contentWidth: number, dayCount: number): number {
  if (dayCount <= 0) return 0;
  const slot = contentWidth / dayCount;
  return Math.round(Math.min(10, Math.max(1, slot * 0.6)) * 10) / 10;
}

export interface TargetStep {
  from: number;
  to: number;
  value: number;
}

/** Runs of the same target as horizontal steps, by day index. No line is drawn before the first target. */
export function targetSteps(days: readonly IntakeDay[]): TargetStep[] {
  const steps: TargetStep[] = [];
  days.forEach((day, index) => {
    if (day.target == null) return;
    const last = steps[steps.length - 1];
    if (last && last.to === index - 1 && last.value === day.target) last.to = index;
    else steps.push({ from: index, to: index, value: day.target });
  });
  return steps;
}

export interface IntakeStats {
  average: number | null;
  /** Target on the last day that had one. */
  target: number | null;
  logged: number;
  total: number;
  /** Days that met the line: see {@link metGoal}. */
  hit: number;
}

export function intakeStats(days: readonly IntakeDay[], kind: GoalKind): IntakeStats {
  const logged = days.filter((day) => day.logged && day.value != null);
  const sum = logged.reduce((total, day) => total + (day.value ?? 0), 0);
  let target: number | null = null;
  for (const day of days) if (day.target != null) target = day.target;
  const hit = logged.filter((day) => metGoal(day.value, day.target, kind)).length;
  return {
    average: logged.length ? sum / logged.length : null,
    target,
    logged: logged.length,
    total: days.length,
    hit,
  };
}

/** NNR 2023 fibre for adults: at least 25 g a day for women and 35 g for men. Unknown sex has no line. */
export function fiberMinimum(sex: string | null | undefined): number | null {
  if (sex === "male") return 35;
  if (sex === "female") return 25;
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthTick {
  index: number;
  text: string;
}

/** First day of each month, skipping a month that would sit closer than `minGap` px to the last label. January shows the year. */
export function monthTicks(dates: readonly string[], contentWidth: number, minGap = 48): MonthTick[] {
  if (!dates.length) return [];
  const slot = contentWidth / dates.length;
  const ticks: MonthTick[] = [];
  let lastX = -Infinity;
  dates.forEach((date, index) => {
    if (!date.endsWith("-01")) return;
    const x = index * slot;
    if (x - lastX < minGap) return;
    const month = Number(date.slice(5, 7)) - 1;
    ticks.push({ index, text: month === 0 ? `Jan ${date.slice(2, 4)}` : MONTHS[month] });
    lastX = x;
  });
  return ticks;
}

/** First and last day in view while the chart scrolls. */
export function visibleSpan(dates: readonly string[], scrollLeft: number, viewWidth: number, contentWidth: number): { from: string; to: string } | null {
  if (!dates.length || contentWidth <= 0) return null;
  const slot = contentWidth / dates.length;
  const first = Math.max(0, Math.min(dates.length - 1, Math.floor(scrollLeft / slot)));
  const last = Math.max(first, Math.min(dates.length - 1, Math.ceil((scrollLeft + viewWidth) / slot) - 1));
  return { from: dates[first], to: dates[last] };
}

/** A round top and two to four even ticks from 0, so labels read 0 · 1,000 · 2,000 · 3,000, not 0 · 872 · 1,744. */
export function intakeScale(max: number): { top: number; ticks: number[] } {
  const high = Math.max(1, max) * 1.05;
  const rough = high / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rough - 1e-9) ?? rough;
  const top = Math.ceil(high / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + 1e-9; tick += step) ticks.push(Math.round(tick * 100) / 100);
  return { top, ticks };
}
