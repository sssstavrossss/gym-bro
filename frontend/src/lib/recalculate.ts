import { int } from "./format";

export const recalculateBannerText = "Time to recalculate your target";

/** The card stays up for the week unless this week's recalculation or dismissal already happened. */
export function bannerVisible(recalculatedThisWeek: boolean, dismissedThisWeek: boolean): boolean {
  return !recalculatedThisWeek && !dismissedThisWeek;
}

export function unreadCount(items: readonly { readAt: string | null }[]): number {
  return items.filter((item) => item.readAt == null).length;
}

export interface LowDay {
  date: string;
  kcal: number;
  targetKcal: number | null;
  included: boolean;
}

/** What the low-day card says the person chose: all counted, all left out, or a mix from the calendar. */
export type LowChoice = "count" | "leave" | "mixed";

export function lowChoice(days: readonly LowDay[]): LowChoice | null {
  if (!days.length) return null;
  if (days.every((day) => day.included)) return "count";
  if (days.every((day) => !day.included)) return "leave";
  return "mixed";
}

/** A day's share of its own target, rounded: 1,540 of 2,234 is 69%. */
export function percentOfTarget(day: LowDay): number | null {
  if (!day.targetKcal) return null;
  return Math.round((day.kcal / day.targetKcal) * 100);
}

export function lowTitle(count: number): string {
  return count === 1 ? "1 day looks low" : `${count} days look low`;
}

export function lowSummary(count: number, choice: LowChoice): string {
  const days = count === 1 ? "1 low day" : `${count} low days`;
  if (choice === "count") return `${days} counted`;
  if (choice === "leave") return `${days} left out`;
  return `${days}: some counted`;
}

export interface BurnStrip {
  min: number;
  max: number;
  ticks: number[];
  band: { left: number; width: number };
  was: number;
  now: number;
}

const steps = [50, 100, 200, 250, 500, 1000];

function ticksBetween(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(value);
  return ticks;
}

/**
 * Positions for the burn strip: the measured range as a band, the old burn and
 * the new one as dots. The scale pads the values by a tenth and rounds to 50;
 * ticks sit on round numbers inside it, at most 5 of them. Positions are
 * percents of the strip's width.
 */
export function burnStrip(prior: number, measured: number, measuredSd: number, burn: number): BurnStrip {
  const low = Math.min(prior, burn, measured - measuredSd);
  const high = Math.max(prior, burn, measured + measuredSd);
  const pad = Math.max(high - low, 100) / 10;
  const min = Math.floor((low - pad) / 50) * 50;
  const max = Math.ceil((high + pad) / 50) * 50;
  const step = steps.find((size) => ticksBetween(min, max, size).length <= 5) ?? 1000;
  const ticks = ticksBetween(min, max, step);
  const at = (value: number) => ((value - min) / (max - min)) * 100;
  const left = at(measured - measuredSd);
  return {
    min,
    max,
    ticks,
    band: { left, width: at(measured + measuredSd) - left },
    was: at(prior),
    now: at(burn),
  };
}

/** "86%": the share of the gap between the old burn and the measurement that the new burn moved. */
export function stepPercent(gain: number): string {
  return `${Math.round(gain * 100)}%`;
}

/** "Last 8 weeks" when the period was cut short, otherwise the day count. */
export function periodLabel(periodDays: number, capped: boolean): string {
  if (capped) return `Last ${Math.round(periodDays / 7)} weeks`;
  return periodDays === 1 ? "1 day" : `${periodDays} days`;
}

/** How the measured burn was worked out, by the weight's direction. */
export function measureNote(rateKgPerWeek: number): string {
  if (rateKgPerWeek < 0) return "Ate + weight lost × 7,700";
  if (rateKgPerWeek > 0) return "Ate − weight gained × 7,700";
  return "Ate, with your weight steady";
}

/** Why the burn moved as far as it did. A big step means the weigh-ins line up; a small one means few or noisy ones. */
export function stepCaption(gain: number): string {
  const moved = `Your burn moved ${stepPercent(gain)} of the way to it`;
  const why = gain >= 0.7
    ? " because your weigh-ins line up well."
    : gain < 0.4
      ? " because there are few weigh-ins or they jump around."
      : ".";
  return `The band is the measured range. ${moved}${why} Few or noisy weigh-ins move it less, so one odd week can't swing your target.`;
}

/** "Target = burn 2,590 − 550 to lose 0.5 kg a week." The rate comes in already formatted in the shown unit. */
export function targetLine(burn: number, kcal: number, goal: "lose" | "maintain" | "gain", rate: string): string {
  const gap = kcal - burn;
  if (goal === "maintain" || gap === 0) return `Target = burn ${int(burn)} to keep your weight.`;
  const sign = gap < 0 ? "−" : "+";
  const verb = goal === "lose" ? "lose" : "gain";
  return `Target = burn ${int(burn)} ${sign} ${int(Math.abs(gap))} to ${verb} ${rate} a week.`;
}
