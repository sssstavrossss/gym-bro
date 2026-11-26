import { describe, expect, it } from "vitest";
import { canDescribe, DESCRIBE_WORKOUT_MAX, describedExercises, describedLine, unmatchedLine } from "../src/lib/describeWorkout";

const none = { kg: null, reps: null, seconds: null, metres: null };

describe("describe a workout", () => {
  it("sends words within the limit", () => {
    expect(canDescribe("  ")).toBe(false);
    expect(canDescribe("squat 3x5")).toBe(true);
    expect(canDescribe("a".repeat(DESCRIBE_WORKOUT_MAX))).toBe(true);
    expect(canDescribe("a".repeat(DESCRIBE_WORKOUT_MAX + 1))).toBe(false);
  });

  it("brings sets with a value in done, and leaves empty ones to fill in", () => {
    let n = 0;
    const added = describedExercises([
      { exerciseId: "barbell-squat", superset: true, sets: [{ ...none, kg: 100, reps: 5 }, { ...none, reps: 5 }] },
      { exerciseId: "pullups", superset: true, sets: [{ ...none, reps: 10 }] },
      { exerciseId: "plank", superset: false, sets: [] },
      { exerciseId: "run", superset: false, sets: [none] },
    ], () => `k${++n}`, "2026-11-26T10:00:00.000Z");

    expect(added.map((exercise) => exercise.key)).toEqual(["k1", "k2", "k3", "k4"]);
    // The first can't join the one before it, which isn't from the words.
    expect(added[0].superset).toBeUndefined();
    expect(added[1].superset).toBe(true);
    expect(added[0].sets[0]).toEqual({ type: "working", kg: 100, reps: 5, rir: null, seconds: null, metres: null, doneAt: "2026-11-26T10:00:00.000Z" });
    expect(added[0].sets[1].kg).toBeNull();
    expect(added[2].sets).toEqual([{ type: "working", kg: null, reps: null, rir: null, seconds: null, metres: null, doneAt: null }]);
    expect(added[3].sets[0].doneAt).toBeNull();

    expect(describedLine(added)).toBe("Added 4 exercises, 3 sets");
    expect(describedLine(added.slice(2, 3))).toBe("Added 1 exercise");
    expect(describedLine(added.slice(1, 2))).toBe("Added 1 exercise, 1 set");
  });

  it("names what the library didn't have", () => {
    expect(unmatchedLine([])).toBe("");
    expect(unmatchedLine(["juggling"])).toBe("Couldn't find “juggling” in the library. Add it with + Exercise.");
    expect(unmatchedLine(["juggling", "yoga", "tai chi"])).toBe("Couldn't find “juggling”, “yoga” and “tai chi” in the library. Add them with + Exercise.");
  });
});
