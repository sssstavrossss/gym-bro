import { describe, expect, it } from "vitest";
import {
  answersOf,
  defaultAnswers,
  easeInFor,
  nextLine,
  targetLine,
  targetOf,
  upNext,
  weekLine,
  weekRir,
  weekSets,
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
      easeIn: true, split: "full_body", blockWeeks: 6, startDate: "2026-11-25", updatedAt: "", workouts: [], lastPosition: null,
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

describe("up next", () => {
  const workouts = [workout("Upper A", [3, 3]), workout("Lower A", [3, 3]), workout("Upper B", [3, 3]), workout("Lower B", [4, 3, 1])];
  const plan = { workouts, weekdays: [0, 1, 3, 4], blockWeeks: 6, easeIn: false, lastPosition: null as number | null };

  it("starts at the first workout, then follows the latest done or skipped", () => {
    expect(upNext(plan)).toMatchObject({ position: 0, block: 1, week: 1, rir: 3, lighter: false });
    expect(upNext(plan)!.workout.name).toBe("Upper A");
    expect(upNext({ ...plan, lastPosition: 2 })!.workout.name).toBe("Lower B");
    expect(upNext({ ...plan, lastPosition: 3 })).toMatchObject({ position: 4, week: 2 });
    expect(upNext({ ...plan, lastPosition: 3 })!.workout.name).toBe("Upper A");
  });

  it("counts finished workouts still waiting to send, from this plan only", () => {
    const waiting = [{ workoutId: "Lower A", position: 1 }, { workoutId: "other", position: 40 }];
    expect(upNext({ ...plan, lastPosition: 0 }, waiting)!.position).toBe(2);
  });

  it("counts a week as days a week of plan workouts, not the sequence's length", () => {
    const twoDays = { ...plan, weekdays: [0, 3] };
    expect(upNext({ ...twoDays, lastPosition: 1 })).toMatchObject({ position: 2, week: 2 });
    // Six weeks of two make a block; the 13th workout starts block 2.
    expect(upNext({ ...twoDays, lastPosition: 10 })).toMatchObject({ week: 6, lighter: true, rir: 4 });
    expect(upNext({ ...twoDays, lastPosition: 11 })).toMatchObject({ block: 2, week: 1, rir: 3 });
  });

  it("steps reps in reserve from 3 to 1, then a lighter week; easing in starts at 4 in the first block only", () => {
    expect([1, 2, 3, 4, 5, 6].map((week) => weekRir(week, 6, false))).toEqual([3, 3, 2, 2, 1, 4]);
    expect([1, 2, 3, 4, 5, 6].map((week) => weekRir(week, 6, true))).toEqual([4, 3, 2, 2, 1, 4]);
    const easing = { ...plan, easeIn: true };
    expect(upNext(easing)!.rir).toBe(4);
    expect(upNext({ ...easing, lastPosition: 23 })).toMatchObject({ block: 2, week: 1, rir: 3 });
  });

  it("halves the sets in a lighter week", () => {
    const exercise = workouts[3].exercises[0];
    expect(weekSets(exercise, false)).toBe(4);
    expect(weekSets(exercise, true)).toBe(2);
    expect(weekSets(workouts[3].exercises[2], true)).toBe(1);
    expect(weekSets(workouts[0].exercises[0], true)).toBe(2);
  });

  it("writes the week and the workout", () => {
    expect(weekLine({ week: 2, rir: 3, lighter: false }, 6)).toBe("Week 2 of 6 · 3 reps in reserve");
    expect(weekLine({ week: 5, rir: 1, lighter: false }, 6)).toBe("Week 5 of 6 · 1 rep in reserve");
    expect(weekLine({ week: 6, rir: 4, lighter: true }, 6)).toBe("Week 6 of 6 · lighter week");
    const lighter = upNext({ ...plan, lastPosition: 20 })!;
    expect(lighter.lighter).toBe(true);
    expect(nextLine(lighter)).toBe("2 exercises · 4 sets");
    expect(nextLine(upNext(plan)!)).toBe("2 exercises · 6 sets · ~50 min");
  });

  it("gives each exercise its target", () => {
    const target = targetOf({ exerciseId: "a", sets: 3, repMin: 6, repMax: 10, seconds: null, restSeconds: 120 }, { rir: 2 });
    expect(target).toEqual({ repMin: 6, repMax: 10, seconds: null, rir: 2, restSeconds: 120 });
    expect(targetLine(target)).toBe("6–10 reps · 2 in reserve");
    expect(targetLine({ ...target, repMin: null, repMax: null, seconds: 45 })).toBe("45 s hold");
  });
});
