import { describe, expect, it } from "vitest";
import { defaultRange, loadStep, loadTargetOf, suggestLoad, suggestionLine, type LoadTarget, type LoggedSet } from "../src/lib/progression";

const set = (kg: number | null, reps: number | null, rir: number | null = null, type: LoggedSet["type"] = "working"): LoggedSet => ({ type, kg, reps, rir });
const range: LoadTarget = { repMin: 6, repMax: 10, rir: 2, easing: false };

describe("load steps", () => {
  it("steps by the kit's smallest change, and not at all for body weight", () => {
    expect(loadStep("barbell")).toBe(2.5);
    expect(loadStep("dumbbell")).toBe(2);
    expect(loadStep("kettlebells")).toBe(4);
    expect(loadStep("body only")).toBeNull();
    expect(loadStep(null)).toBeNull();
  });

  it("aims compounds at 6–10 reps and isolation at 10–15", () => {
    expect(defaultRange("compound")).toEqual({ repMin: 6, repMax: 10 });
    expect(defaultRange("isolation")).toEqual({ repMin: 10, repMax: 15 });
    expect(defaultRange(null)).toEqual({ repMin: 10, repMax: 15 });
  });

  it("takes the plan's range and effort, else the default with any effort; nothing for holds or other measures", () => {
    const target = { repMin: 8, repMax: 12, seconds: null, rir: 3, easing: true };
    expect(loadTargetOf(target, "weight_reps", "compound")).toEqual({ repMin: 8, repMax: 12, rir: 3, easing: true });
    expect(loadTargetOf(null, "weight_reps", "compound")).toEqual({ repMin: 6, repMax: 10, rir: null, easing: false });
    expect(loadTargetOf({ ...target, repMin: null, repMax: null, seconds: 45 }, "weight_reps", null)).toBeNull();
    expect(loadTargetOf(null, "reps", "compound")).toBeNull();
  });
});

describe("load suggestions", () => {
  it("steps up once every set reaches the top of the range at or under the target effort", () => {
    const up = suggestLoad([set(40, 8, null, "warmup"), set(60, 10, 2), set(60, 10, 3), set(60, 11, 2)], null, range, "barbell");
    expect(up).toEqual({ kind: "up", kg: 62.5, change: 2.5, reps: 6, lastKg: 60 });
    expect(suggestionLine(up!, range)).toBe("Try 62.5 kg, up 2.5: every set reached 10 last time");
  });

  it("holds when a set fell short of the top, or got there harder than the target", () => {
    const short = suggestLoad([set(60, 10), set(60, 9)], null, range, "barbell");
    expect(short).toMatchObject({ kind: "hold", kg: 60, change: 0, reps: null });
    expect(suggestionLine(short!, range)).toBe("Stay at 60 kg until every set reaches 10");
    expect(suggestLoad([set(60, 10, 2), set(60, 10, 1)], null, range, "barbell")!.kind).toBe("hold");
    // A free workout has no effort target, and a set with no RIR counts as on target.
    expect(suggestLoad([set(60, 10, 0)], null, { ...range, rir: null }, "barbell")!.kind).toBe("up");
    expect(suggestLoad([set(60, 10, null)], null, range, "barbell")!.kind).toBe("up");
  });

  it("judges the heaviest working sets, not warm-ups, drops or lighter back-off sets", () => {
    const sets = [set(100, 3, null, "warmup"), set(80, 10), set(70, 12), set(50, 20, null, "drop")];
    expect(suggestLoad(sets, null, range, "barbell")).toMatchObject({ kind: "up", kg: 82.5, lastKg: 80 });
  });

  it("eases off about 10% after missing the bottom of the range twice running", () => {
    const missed = [set(100, 6), set(100, 5)];
    expect(suggestLoad(missed, null, range, "barbell")!.kind).toBe("hold");
    expect(suggestLoad(missed, [set(100, 7)], range, "barbell")!.kind).toBe("hold");
    expect(suggestLoad(missed, [set(97.5, 5)], range, "barbell")!.kind).toBe("hold");
    const ease = suggestLoad(missed, [set(100, 5), set(100, 4)], range, "barbell");
    expect(ease).toEqual({ kind: "ease", kg: 90, change: -10, reps: null, lastKg: 100 });
    expect(suggestionLine(ease!, range)).toBe("Try 90 kg, down 10: short of the range twice");
    // At least one step, and never to nothing.
    expect(suggestLoad([set(12, 4)], [set(12, 4)], range, "dumbbell")).toMatchObject({ kind: "ease", kg: 10, change: -2 });
    expect(suggestLoad([set(2, 4)], [set(2, 4)], range, "dumbbell")!.kind).toBe("hold");
  });

  it("halves a bar's or a stack's step when easing in or when a step is over 10%; dumbbells and bells can't", () => {
    expect(suggestLoad([set(60, 10)], null, { ...range, easing: true }, "barbell")!.kg).toBe(61.25);
    expect(suggestLoad([set(20, 10)], null, range, "cable")!.kg).toBe(21.25);
    expect(suggestLoad([set(10, 10)], null, { ...range, easing: true }, "dumbbell")!.kg).toBe(12);
    expect(suggestLoad([set(16, 15)], null, { ...range, repMax: 15 }, "kettlebells")!.kg).toBe(20);
  });

  it("has nothing to say without weighted working sets, or for kit that doesn't step", () => {
    expect(suggestLoad([set(null, 12)], null, range, "barbell")).toBeNull();
    expect(suggestLoad([set(0, 12)], null, range, "barbell")).toBeNull();
    expect(suggestLoad([set(20, 10, null, "warmup")], null, range, "barbell")).toBeNull();
    expect(suggestLoad([set(10, 12)], null, range, "body only")).toBeNull();
  });
});
