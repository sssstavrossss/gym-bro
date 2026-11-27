import { describe, expect, it } from "vitest";
import { answersOf, defaultAnswers, mobilityLine, targetLine, onlyMobilityChanged, remakes, type Plan, type PlanAnswers } from "../src/lib/plan";
import { addIndex, partHeading, samePart, swapExercise, toggleSuperset, type DraftExercise } from "../src/lib/workout";

const move = { exerciseId: "arm-circles", sets: 1, repMin: null, repMax: null, seconds: 30, restSeconds: 0 };

describe("mobilityLine", () => {
  it("says which the workout has, as minutes on top of its own", () => {
    expect(mobilityLine({ warmUp: [move], coolDown: [move] })).toBe("+ 3 min warm-up · 3 min cool-down");
    expect(mobilityLine({ warmUp: [move], coolDown: null })).toBe("+ 3 min warm-up");
    expect(mobilityLine({ warmUp: [], coolDown: [move] })).toBe("+ 3 min cool-down");
    expect(mobilityLine({})).toBe("");
  });
});

describe("a warm-up move's target", () => {
  it("keeps going for its time rather than holding", () => {
    const target = { repMin: null, repMax: null, seconds: 30, metres: null, rir: 3, restSeconds: 0, easing: false };
    expect(targetLine(target, true)).toBe("30 s");
    expect(targetLine(target)).toBe("30 s hold");
  });
});

describe("onlyMobilityChanged", () => {
  const base: PlanAnswers = defaultAnswers();

  it("is true when only the warm-up or cool-down differs", () => {
    expect(onlyMobilityChanged(base, { ...base, warmUp: true })).toBe(true);
    expect(onlyMobilityChanged(base, { ...base, coolDown: true, weekdays: [4, 2, 0] })).toBe(true);
  });

  it("is false with no change, or with any other change", () => {
    expect(onlyMobilityChanged(base, { ...base })).toBe(false);
    expect(onlyMobilityChanged(base, { ...base, warmUp: true, minutes: 45 })).toBe(false);
    expect(onlyMobilityChanged(base, { ...base, coolDown: true, goEasy: ["knees"] })).toBe(false);
    expect(onlyMobilityChanged(base, { ...base, warmUp: true, split: "upper_lower" })).toBe(false);
  });

  it("keeps hand edits when saving only changes the warm-up or cool-down", () => {
    const plan = {
      id: "p", goal: "muscle", weekdays: [0, 2, 4], minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], easeIn: false,
      split: "full_body", warmUp: false, coolDown: false, blockWeeks: 6, startDate: "2026-11-23", updatedAt: "", workouts: [], lastPosition: null,
    } as Plan;
    expect(remakes(plan, "full_body", { ...answersOf(plan), coolDown: true })).toBe(false);
    expect(remakes(plan, "full_body", answersOf(plan))).toBe(true);
    expect(remakes(plan, "full_body")).toBe(true);
  });

  it("reads a plan from before the settings as both off", () => {
    const old = { goal: "muscle", weekdays: [0], minutes: 30, experience: "new", equipment: ["gym"], goEasy: [], easeIn: true, split: "full_body" } as unknown as Plan;
    expect(answersOf(old)).toMatchObject({ warmUp: false, coolDown: false });
  });
});

const ex = (key: string, part?: DraftExercise["part"], superset = false): DraftExercise => ({ key, exerciseId: key, sets: [], part, superset });

describe("workout parts", () => {
  const exercises = [ex("w1", "warmup"), ex("w2", "warmup"), ex("a"), ex("b", undefined, true), ex("c1", "cooldown")];
  const runs = [[exercises[0]], [exercises[1]], [exercises[2], exercises[3]], [exercises[4]]];

  it("heads each part where it starts", () => {
    expect(runs.map((_, index) => partHeading(runs, index))).toEqual(["Warm-up", null, "Workout", "Cool-down"]);
  });

  it("has no headings without a warm-up or cool-down", () => {
    expect(partHeading([[ex("a")], [ex("b")]], 0)).toBeNull();
  });

  it("adds a new exercise before the cool-down", () => {
    expect(addIndex(exercises)).toBe(4);
    expect(addIndex([ex("a")])).toBe(1);
  });

  it("never joins a superset across parts", () => {
    expect(samePart(exercises[1], exercises[2])).toBe(false);
    expect(toggleSuperset(exercises, "a").find((item) => item.key === "a")?.superset).toBeFalsy();
    expect(toggleSuperset(exercises, "w2").find((item) => item.key === "w2")?.superset).toBe(true);
  });

  it("keeps a swapped move in its part", () => {
    expect(swapExercise(exercises[4], "triceps-stretch", "n").next.part).toBe("cooldown");
    expect(swapExercise(exercises[2], "pullups", "n").next.part).toBeUndefined();
  });
});
