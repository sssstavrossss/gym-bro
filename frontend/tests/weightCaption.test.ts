import { describe, expect, it } from "vitest";
import type { WeightResponse } from "../src/api";
import { weightCaption } from "../src/state/profile";

function weight(partial: Partial<WeightResponse>): WeightResponse {
  return {
    asOf: "2026-10-24",
    trendKg: null,
    trendState: null,
    reasons: [],
    latestKg: null,
    latestDate: null,
    weighInsInWindow: 0,
    windowDays: 7,
    smoothingShare: 0.1,
    usedKg: null,
    source: "none",
    goalReached: false,
    freshStart: null,
    ...partial,
  };
}

describe("weightCaption", () => {
  it("shows a placeholder when there is no trend", () => {
    expect(weightCaption(null)).toEqual({ label: "Weight", value: "—", note: "", low: false, fresh: false });
    expect(weightCaption(weight({ source: "none" })).label).toBe("Weight");
  });

  it("publishes the first weigh-in as a low-accuracy trend", () => {
    expect(weightCaption(weight({
      trendKg: 83.6,
      trendState: "low_accuracy",
      reasons: ["fewer_than_2_weighins_7d"],
      latestKg: 83.6,
      usedKg: 83.6,
      source: "trend",
      weighInsInWindow: 1,
    }))).toEqual({
      label: "trend · low accuracy",
      value: "83.60 kg",
      note: "low accuracy",
      low: true,
      fresh: false,
    });
  });

  it("labels a normal trend with the published kilograms", () => {
    expect(weightCaption(weight({
      trendKg: 83.6,
      trendState: "normal",
      latestKg: 83.3,
      usedKg: 83.6,
      source: "trend",
      weighInsInWindow: 4,
    }))).toEqual({
      label: "trend",
      value: "83.60 kg",
      note: "",
      low: false,
      fresh: false,
    });
  });
});
