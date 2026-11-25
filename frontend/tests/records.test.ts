import { describe, expect, it } from "vitest";
import { bestOf, estimatedMax, maxText, newBestLine, newBests, type ScoredSet } from "../src/lib/records";

const set = (kg: number | null, reps: number | null, rir: number | null = null, type: ScoredSet["type"] = "working") => ({ type, kg, reps, rir });
const done = (kg: number, reps: number, rir: number | null = null, type: ScoredSet["type"] = "working") => ({ ...set(kg, reps, rir, type), doneAt: "2026-11-25T18:00:00Z" });

describe("estimated max", () => {
  it("is Epley with reps in reserve, as the API works it out", () => {
    expect(estimatedMax(set(100, 5, 2))).toBe(123.33);
    expect(estimatedMax(set(100, 5))).toBe(116.67);
    expect(estimatedMax(set(100, 1, 0))).toBe(103.33);
  });

  it("leaves out warm-ups, drop sets, no weight and more than 20 reps", () => {
    expect(estimatedMax(set(100, 5, 2, "warmup"))).toBeNull();
    expect(estimatedMax(set(60, 8, 0, "drop"))).toBeNull();
    expect(estimatedMax(set(null, 8))).toBeNull();
    expect(estimatedMax(set(0, 8))).toBeNull();
    expect(estimatedMax(set(60, 21))).toBeNull();
    expect(estimatedMax(set(60, 20))).toBe(100);
  });

  it("picks the best set, the first on a tie", () => {
    expect(bestOf([set(100, 5, 2), set(110, 1, 2), set(90, 8, 2)])).toEqual({ kg: 100, reps: 5, rir: 2, estimatedMax: 123.33 });
    expect(bestOf([set(null, 10)])).toBeNull();
  });
});

describe("new bests", () => {
  const before = (id: string) => (id === "bench" ? { estimatedMax: 80 } : null);

  it("names an exercise's best ticked set when it beats the best so far", () => {
    const found = newBests(
      [
        { exerciseId: "bench", sets: [done(60, 10, 2), { ...set(80, 10, 2), doneAt: null }] },
        { exerciseId: "bench", sets: [done(65, 8, 2)] },
        { exerciseId: "row", sets: [done(200, 5)] },
      ],
      before,
    );
    // 60 × 10 at 2 in reserve is 84; 65 × 8 at 2 in reserve is 86.67; the unticked 80 × 10 doesn't count.
    expect(found).toEqual([{ exerciseId: "bench", kg: 65, reps: 8, rir: 2, estimatedMax: 86.67, was: 80 }]);
    expect(newBestLine(found[0])).toBe("est. max 86.5 kg, up 6.5");
  });

  it("doesn't call a first time or a tie a record", () => {
    expect(newBests([{ exerciseId: "row", sets: [done(100, 5)] }], before)).toEqual([]);
    expect(newBests([{ exerciseId: "bench", sets: [done(60, 10)] }], before)).toEqual([]);
  });

  it("shows the max to the nearest half kilo", () => {
    expect(maxText(123.33)).toBe("123.5 kg");
    expect(maxText(116.67)).toBe("116.5 kg");
    expect(newBestLine({ exerciseId: "a", kg: 80, reps: 1, rir: 0, estimatedMax: 82.67, was: 82.5 })).toBe("est. max 82.5 kg");
  });
});
