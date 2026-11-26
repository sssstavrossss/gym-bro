import { describe, expect, it } from "vitest";
import { startText, trainCards, type TrainInput } from "../src/lib/train";

const first: TrainInput = { active: false, planState: "ready", hasPlan: false, historyState: "ready", historyRows: 0, waiting: 0 };

describe("trainCards", () => {
  it("shows a first visit the plan, the start, the library and the history prompt, but no History", () => {
    expect(trainCards(first)).toEqual({ inProgress: false, start: true, makePlan: true, explore: true, trainedBefore: true, history: false });
  });

  it("shows History once there is a workout, saved or waiting to send", () => {
    expect(trainCards({ ...first, historyRows: 3 })).toMatchObject({ history: true, trainedBefore: false });
    expect(trainCards({ ...first, waiting: 1 })).toMatchObject({ history: true, trainedBefore: false });
  });

  it("shows neither History nor the prompt while history loads, so nothing jumps", () => {
    for (const historyState of ["idle", "loading"] as const) {
      expect(trainCards({ ...first, historyState })).toMatchObject({ history: false, trainedBefore: false });
    }
    // A finished workout waiting to send shows straight away.
    expect(trainCards({ ...first, historyState: "loading", waiting: 1 })).toMatchObject({ history: true });
  });

  it("keeps History up when it fails to load, to say so", () => {
    expect(trainCards({ ...first, historyState: "failed" })).toMatchObject({ history: true, trainedBefore: false });
  });

  it("drops Make a plan and Explore with a plan, or until the plan has loaded", () => {
    expect(trainCards({ ...first, hasPlan: true })).toMatchObject({ makePlan: false, explore: false });
    expect(trainCards({ ...first, planState: "loading" })).toMatchObject({ makePlan: false, explore: false });
    expect(trainCards({ ...first, planState: "failed" })).toMatchObject({ makePlan: false, explore: false });
  });

  it("swaps the start for the workout in progress", () => {
    expect(trainCards({ ...first, active: true })).toMatchObject({ inProgress: true, start: false });
  });
});

describe("startText", () => {
  it("names the card by whether there is a plan, and offers Describe only when it works", () => {
    expect(startText(false, true)).toEqual({ title: "Start a workout", caption: "Add exercises as you go, or describe it" });
    expect(startText(false, false).caption).toBe("Add exercises as you go and tick off each set");
    expect(startText(true, true)).toEqual({ title: "Something else today?", caption: "Off the plan: add exercises as you go, or describe it" });
    expect(startText(true, false).caption).toBe("Off the plan: add exercises as you go");
  });
});
