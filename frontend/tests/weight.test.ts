import { describe, expect, it } from "vitest";
import type { WeightChartPoint, WeightResponse } from "../src/api";
import { allowDeletingTheOnlyWeighIn, zeroWeighInsDotCopy } from "../src/lib/partADecisions";
import { accuracyCopy, gapLabel, isLowAccuracy, profileTrendLabel, trendChange, weightSubtitle } from "../src/lib/weightDisplay";

function point(date: string, trendKg: number | null, gap = false): WeightChartPoint {
  return { date, trendKg, weighInKg: null, readingKg: null, realWeighIn: false, estimated: trendKg == null, gap };
}

function weight(patch: Partial<WeightResponse>): WeightResponse {
  return {
    asOf: "2026-10-24",
    trendKg: 83.6,
    trendState: "low_accuracy",
    reasons: ["fewer_than_2_weighins_7d"],
    latestKg: 83.6,
    latestDate: "2026-10-24",
    weighInsInWindow: 1,
    windowDays: 7,
    smoothingShare: 0.1,
    usedKg: 83.6,
    source: "trend",
    goalReached: false,
    freshStart: null,
    ...patch,
  };
}

describe("weight display", () => {
  it("labels a fresh gap the way the prototype does", () => {
    expect(gapLabel(29)).toBe("over 4 weeks");
    expect(gapLabel(34)).toBe("over 4 weeks");
    expect(gapLabel(35)).toBe("5 weeks");
  });

  it("keeps the weight line to one idea", () => {
    expect(weightSubtitle(83.3, false, false, -0.36)).toBe("latest 83.3 · −0.4 kg/wk");
    expect(weightSubtitle(83.6, false, true, -0.4)).toBe("latest 83.6 · low accuracy");
    expect(weightSubtitle(90, true, true, -1)).toBe("latest 90.0 · fresh start");
  });

  it("hides this week and 30 days across a fresh start", () => {
    const series = [point("2026-10-17", 80), point("2026-10-24", 90)];
    expect(trendChange(series, 1, true)).toBeNull();
    expect(trendChange(series, 1, false)).toBe(10);
    expect(trendChange([point("2026-10-17", null, true), point("2026-10-24", 90)], 1, false)).toBeNull();
  });

  it("says trend · low accuracy on the profile", () => {
    expect(profileTrendLabel(weight({}))).toBe("trend · low accuracy");
    expect(isLowAccuracy(weight({ trendState: "normal", reasons: [], weighInsInWindow: 2 }))).toBe(false);
    expect(profileTrendLabel(weight({ trendState: "normal", reasons: [], weighInsInWindow: 2 }))).toBe("trend");
  });

  it("uses the zero-weigh-in wording from the open decision", () => {
    expect(allowDeletingTheOnlyWeighIn()).toBe(true);
    const copy = zeroWeighInsDotCopy(12);
    expect(copy.short).toBe("no weigh-ins this week");
    expect(copy.line).toContain("No weigh-ins in the last 7 days");
    expect(copy.line).toContain("12 days ago");
    const spoken = accuracyCopy(weight({
      weighInsInWindow: 0,
      latestDate: "2026-10-10",
      trendState: "low_accuracy",
    }));
    expect(spoken.short).toBe("no weigh-ins this week");
    expect(spoken.lines[0]).toContain("14 days ago");
  });

  it("describes one weigh-in and a fresh start together", () => {
    const spoken = accuracyCopy(weight({
      trendState: "fresh_start",
      latestKg: 90,
      weighInsInWindow: 1,
      freshStart: {
        date: "2026-10-24",
        previousDate: "2026-09-25",
        daysSincePrevious: 29,
        weeksSincePrevious: 4,
        recalculatePending: true,
      },
    }));
    expect(spoken.lines[0]).toContain("over 4 weeks");
    expect(spoken.lines[0]).toContain("90.0 kg");
    expect(spoken.lines[1]).toContain("Only 1 weigh-in this week");
    expect(spoken.short).toContain("fresh start");
  });
});
