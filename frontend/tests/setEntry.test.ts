import { describe, expect, it } from "vitest";
import { setLabels, setName } from "../src/lib/setEntry";
import { emptySet, type DraftSet } from "../src/lib/workout";

const done = (kg: number, reps: number, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps, doneAt: "2026-11-27T18:00:00Z" });

describe("a set's name", () => {
  it("names sets, and the one a log would add", () => {
    const sets = [done(20, 10, "warmup"), done(40, 5, "warmup"), done(60, 5), emptySet(), emptySet("drop")];
    expect(setLabels(sets)).toEqual(["W", "W", "1", "2", "D"]);
    expect(setName(sets, 1)).toBe("Warm-up set 2");
    expect(setName(sets, 3)).toBe("Set 2");
    expect(setName(sets, 4)).toBe("Drop set");
    expect(setName(sets, 5)).toBe("Set 3");
  });
});
