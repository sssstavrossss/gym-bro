import { describe, expect, it } from "vitest";
import { warmupRamp, workingKg } from "../src/lib/warmup";

describe("warm-up ramp", () => {
  it("builds a barbell compound from the empty bar to about 80%", () => {
    expect(warmupRamp(100, "barbell", "compound")).toEqual([
      { kg: 20, reps: 10 }, { kg: 40, reps: 8 }, { kg: 60, reps: 5 }, { kg: 80, reps: 3 },
    ]);
  });

  it("never goes under the bar or repeats a weight", () => {
    expect(warmupRamp(50, "barbell", "compound")).toEqual([{ kg: 20, reps: 10 }, { kg: 30, reps: 5 }, { kg: 40, reps: 3 }]);
    expect(warmupRamp(30, "barbell", "compound")).toEqual([{ kg: 20, reps: 8 }, { kg: 25, reps: 3 }]);
    expect(warmupRamp(20, "barbell", "compound")).toEqual([]);
  });

  it("rounds to the kit's step and gives an isolation move one set", () => {
    expect(warmupRamp(30, "dumbbell", "compound")).toEqual([{ kg: 12, reps: 8 }, { kg: 18, reps: 5 }, { kg: 24, reps: 3 }]);
    expect(warmupRamp(14, "dumbbell", "isolation")).toEqual([{ kg: 8, reps: 10 }]);
    expect(warmupRamp(24, "kettlebell", "compound")).toEqual([{ kg: 8, reps: 8 }, { kg: 16, reps: 5 }, { kg: 20, reps: 3 }]);
  });

  it("has nothing for body weight or no weight", () => {
    expect(warmupRamp(0, "barbell", "compound")).toEqual([]);
    expect(warmupRamp(20, "bodyweight", "compound")).toEqual([]);
  });
});

describe("the weight to warm up for", () => {
  const last = [{ type: "warmup", kg: 60 }, { type: "working", kg: 95 }, { type: "working", kg: 100 }];
  it("takes what's typed, then the suggestion, then last time's heaviest", () => {
    expect(workingKg([{ type: "working", kg: 102.5 }], 105, last)).toBe(102.5);
    expect(workingKg([{ type: "working", kg: null }], 105, last)).toBe(105);
    expect(workingKg([{ type: "working", kg: null }], null, last)).toBe(100);
    expect(workingKg([{ type: "working", kg: null }], null, [])).toBeNull();
  });
});
