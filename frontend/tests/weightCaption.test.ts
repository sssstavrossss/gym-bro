import { describe, expect, it } from "vitest";
import type { WeightResponse } from "../src/api";
import { weightCaption } from "../src/state/profile";

function weight(partial: Partial<WeightResponse>): WeightResponse {
  return {
    trendKg: null,
    trendVisible: false,
    latestKg: null,
    latestDate: null,
    weighInsInWindow: 0,
    trendMinimum: 3,
    windowDays: 7,
    usedKg: null,
    source: "none",
    ...partial,
  };
}

describe("weightCaption", () => {
  it("shows nothing when there is no weigh-in", () => {
    expect(weightCaption(null)).toEqual({ label: "", value: "" });
    expect(weightCaption(weight({ source: "none" }))).toEqual({ label: "", value: "" });
  });

  it("does not publish the only weigh-in as the trend", () => {
    expect(weightCaption(weight({
      latestKg: 83.6,
      usedKg: 83.6,
      source: "weigh_in",
      weighInsInWindow: 1,
    }))).toEqual({ label: "Trend not ready", value: "" });
  });

  it("shows the smoothed trend as provisional before three weigh-ins in the window", () => {
    expect(weightCaption(weight({
      latestKg: 90,
      trendKg: 71,
      trendVisible: false,
      usedKg: 71,
      source: "trend",
      weighInsInWindow: 2,
    }))).toEqual({ label: "2 of 3 weigh-ins · provisional", value: "71.00 kg" });
  });

  it("labels a visible trend without the latest raw weight", () => {
    const caption = weightCaption(weight({
      latestKg: 90,
      trendKg: 72.9,
      trendVisible: true,
      usedKg: 72.9,
      source: "trend",
      weighInsInWindow: 3,
    }));
    expect(caption).toEqual({ label: "Trend", value: "72.90 kg" });
  });
});
