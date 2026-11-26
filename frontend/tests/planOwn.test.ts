import { describe, expect, it } from "vitest";
import { droppedOwn, EMPTY_WORKOUT, nextLine, previewSummary, remakes, splitLabel, workoutLine, type PlanWorkout } from "../src/lib/plan";

const empty = (name: string): PlanWorkout => ({ id: name, name, minutes: 0, exercises: [] });
const own = { split: "custom" as const, workouts: [empty("Workout A"), { ...empty("Push day"), edited: true }, empty("Workout C")] };

describe("your own plan", () => {
  it("names the split and says an empty workout has nothing yet", () => {
    expect(splitLabel("custom")).toBe("Your own");
    expect(workoutLine(empty("Workout A"))).toBe(EMPTY_WORKOUT);
    expect(nextLine({ workout: empty("Workout A"), position: 0, week: 1, rir: 3, lighter: true } as never)).toBe(EMPTY_WORKOUT);
  });

  it("previews empty workouts in turn", () => {
    expect(previewSummary({ split: "custom", easeIn: false, warmUp: false, coolDown: false, blockWeeks: 6, workouts: own.workouts })).toEqual({
      title: "Your own, 3 workouts in turn",
      line: "They start empty: after saving, tap each one on the Plan card to add exercises.",
    });
  });

  it("keeps its workouts on a change, dropping the last ones with fewer days", () => {
    expect(remakes(own, "custom")).toBe(false);
    expect(remakes(own, "full_body")).toBe(true);
    expect(remakes({ split: "full_body" }, "custom")).toBe(true);
    expect(remakes(null, "custom")).toBe(false);
    expect(droppedOwn(own, "custom", 1)).toEqual(["Push day", "Workout C"]);
    expect(droppedOwn(own, "custom", 3)).toEqual([]);
    expect(droppedOwn(own, "custom", 5)).toEqual([]);
    expect(droppedOwn(own, "full_body", 1)).toEqual([]);
    expect(droppedOwn(null, "custom", 1)).toEqual([]);
  });
});
