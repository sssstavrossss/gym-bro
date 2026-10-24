// S8: the reason text behind the low-accuracy dot (API: trendState + reasons).
import { computed } from "vue";
import { kg } from "./format";
import { latestWeighIn, today, trendInfo } from "../store";
import { gapLabel } from "./trend";
import { diffDays } from "./dates";

export const accuracyReason = computed(() => {
  const i = trendInfo.value;
  const last = latestWeighIn(today);
  const lines: string[] = [];
  let short = "";
  if (i.reasons.includes("fresh_start") && i.freshGapDays) {
    lines.push(`Fresh start: it had been ${gapLabel(i.freshGapDays)} since your last weigh-in, so the trend restarted from ${last ? kg(last.kg) : ""} kg.`);
    short = `fresh start after ${gapLabel(i.freshGapDays)}`;
  }
  if (i.reasons.includes("few_weigh_ins")) {
    const ago = last ? diffDays(today, last.date) : 0;
    lines.push(i.n7 === 1
      ? "Only 1 weigh-in this week, so the trend is less accurate. Weighing in 2+ times a week helps."
      // decision 35.3, Part A wording (Part B: "…so the trend is estimated from your food log.")
      : `No weigh-ins in the last 7 days (last one ${ago} days ago), so the trend is held where it was then.`);
    short ||= i.n7 === 1 ? "only 1 weigh-in this week" : "no weigh-ins in the last 7 days";
  }
  return { lines, short };
});
