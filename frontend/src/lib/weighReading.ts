import type { WeighInExpectation } from "../api";
import { dayMonth, diffDays, weekday } from "./dates";
import { int } from "./format";
import { kgTo, signedWeight, weightText, type WeightUnit } from "./units";

/** "Expected about 83.6 kg". */
export function expectedTitle(expected: WeighInExpectation, unit: WeightUnit): string {
  return `Expected about ${weightText(expected.expectedKg, unit)} ${unit}`;
}

/** How far a weight is from the expected one: "+0.5 kg", "−0.3 kg", "as expected", or null without a weight. */
export function expectedGap(expected: WeighInExpectation, kg: number | null | undefined, unit: WeightUnit): string | null {
  if (kg == null) return null;
  const gap = kg - expected.expectedKg;
  if (Math.round(kgTo(gap, unit) * 10) === 0) return "as expected";
  return `${signedWeight(gap, unit)} ${unit}`;
}

/** "Thursday", "yesterday", or "12 Nov" for a day more than a week before `today`. */
function dayName(date: string, today: string): string {
  const back = diffDays(today, date);
  if (back === 0) return "today";
  if (back === 1) return "yesterday";
  return back < 7 ? weekday(date) : dayMonth(date);
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Where the expected weight comes from, and why this weigh-in might count for less:
 * "From your food since Thursday and your burn of 2,926 kcal. Sunday was a big day (140% of
 * target), so some of it is likely water. This weigh-in counts less toward your burn." Kept short:
 * the sheet has to fit a phone without scrolling.
 */
export function expectedNote(expected: WeighInExpectation, today: string): string {
  const parts = [`From your food since ${dayName(expected.from, today)} and your burn of ${int(expected.burn)} kcal.`];
  const big = expected.bigDay;
  if (big) {
    const day = capital(dayName(big.date, today));
    const share = Math.round((big.kcal / big.targetKcal) * 100);
    parts.push(expected.habit
      ? `${day} was a big day, as usual before a weigh-in, so it evens out.`
      : `${day} was a big day (${share}% of target), so some of it is likely water.`);
  }
  if (expected.loggedDays < expected.days) {
    const missing = expected.days - expected.loggedDays;
    parts.push(`${missing} unlogged ${missing === 1 ? "day counts" : "days count"} as usual.`);
  }
  if (!expected.sure) parts.push("This weigh-in counts less toward your burn.");
  return parts.join(" ");
}
