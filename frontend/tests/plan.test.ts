import { describe, expect, it } from "vitest";
import {
  answersOf,
  defaultAnswers,
  easeInFor,
  planLine,
  prescription,
  previewSummary,
  splitFor,
  stepMinutes,
  toggled,
  workoutLine,
  type Plan,
  type PlanWorkout,
} from "../src/lib/plan";

const workout = (name: string, sets: number[], minutes = 50): PlanWorkout => ({
  id: name,
  name,
  minutes,
  exercises: sets.map((count, index) => ({ exerciseId: `e${index}`, sets: count, repMin: 6, repMax: 10, seconds: null, restSeconds: 120 })),
});

describe("plan setup", () => {
  it("starts with three days, an hour and a full gym", () => {
    expect(defaultAnswers()).toEqual({
      goal: "muscle", weekdays: [0, 2, 4], minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], easeIn: null, split: null,
    });
  });

  it("picks the split from the days, as the server does", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(splitFor)).toEqual([
      "full_body", "full_body", "full_body", "upper_lower", "ppl_upper_lower", "push_pull_legs", "push_pull_legs",
    ]);
  });

  it("eases in for New and for anyone going easy on an area, unless switched", () => {
    const answers = defaultAnswers();
    expect(easeInFor(answers)).toBe(false);
    expect(easeInFor({ ...answers, experience: "new" })).toBe(true);
    expect(easeInFor({ ...answers, goEasy: ["knees"] })).toBe(true);
    expect(easeInFor({ ...answers, goEasy: ["knees"], easeIn: false })).toBe(false);
    expect(easeInFor({ ...answers, easeIn: true })).toBe(true);
  });

  it("steps the time by five, from 10 to 120", () => {
    expect(stepMinutes(60, 5)).toBe(65);
    expect(stepMinutes(10, -5)).toBe(10);
    expect(stepMinutes(120, 5)).toBe(120);
  });

  it("toggles an item and keeps the list in its own order", () => {
    const order = [0, 1, 2, 3, 4, 5, 6];
    expect(toggled([4, 0], 2, order)).toEqual([0, 2, 4]);
    expect(toggled([0, 2, 4], 2, order)).toEqual([0, 4]);
  });

  it("copies a saved plan's answers without sharing its lists", () => {
    const plan: Plan = {
      id: "p", goal: "strength", weekdays: [1, 3], minutes: 45, experience: "new", equipment: ["dumbbells"], goEasy: ["wrists"],
      easeIn: true, split: "full_body", blockWeeks: 6, startDate: "2026-11-25", updatedAt: "", workouts: [],
    };
    const answers = answersOf(plan);
    expect(answers).toEqual({ goal: "strength", weekdays: [1, 3], minutes: 45, experience: "new", equipment: ["dumbbells"], goEasy: ["wrists"], easeIn: true, split: "full_body" });
    answers.weekdays.push(5);
    expect(plan.weekdays).toEqual([1, 3]);
  });
});

describe("plan lines", () => {
  it("sums a workout", () => {
    expect(workoutLine(workout("Upper A", [3, 3, 3, 3, 3, 1], 55))).toBe("6 exercises · 16 sets · ~55 min");
    expect(workoutLine(workout("Tiny", [1], 5))).toBe("1 exercise · 1 set · ~5 min");
  });

  it("sums the plan", () => {
    expect(planLine({ goal: "muscle", split: "upper_lower", weekdays: [0, 1, 3, 4], minutes: 60 })).toBe("Muscle · Upper / Lower · 4 days · 60 min");
    expect(planLine({ goal: "fitness", split: "full_body", weekdays: [2], minutes: 30 })).toBe("Fitness · Full body · 1 day · 30 min");
  });

  it("sums the preview with rounded averages", () => {
    const summary = previewSummary({
      split: "upper_lower", easeIn: false, blockWeeks: 6,
      workouts: [workout("Upper A", [3, 3, 3, 3, 3]), workout("Lower A", [3, 3, 3, 3]), workout("Upper B", [3, 3, 3, 3, 3]), workout("Lower B", [3, 3, 3, 3, 3])],
    });
    expect(summary).toEqual({
      title: "Upper / Lower, 4 workouts in turn",
      line: "About 5 exercises and 14 sets each · 6-week blocks, the last week lighter",
    });
  });

  it("writes sets and reps, or seconds for a hold", () => {
    expect(prescription({ exerciseId: "a", sets: 3, repMin: 6, repMax: 10, seconds: null, restSeconds: 120 })).toBe("3 × 6–10");
    expect(prescription({ exerciseId: "b", sets: 3, repMin: null, repMax: null, seconds: 45, restSeconds: 60 })).toBe("3 × 45 s");
    expect(prescription({ exerciseId: "c", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 60 })).toBe("2 sets");
  });
});
