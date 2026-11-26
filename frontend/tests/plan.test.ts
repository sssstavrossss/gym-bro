import { describe, expect, it } from "vitest";
import {
  answersOf,
  blockNote,
  dayNames,
  eachMinutes,
  workoutDays,
  dayLabel,
  defaultAnswers,
  easeInFor,
  nextLine,
  targetLine,
  targetOf,
  upNext,
  weekdayOf,
  weekLine,
  weekRir,
  weekSets,
  planLine,
  projectDays,
  prescription,
  previewSummary,
  splitFor,
  splitsFor,
  clockLabel,
  finisherOf,
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
      goal: "muscle", weekdays: [0, 2, 4], minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], easeIn: null, split: null, warmUp: false, coolDown: false,
    });
  });

  it("gives Hyrox its own split, and the others don't take it", () => {
    expect(splitFor(2, "hyrox")).toBe("hyrox");
    expect(splitFor(5, "hyrox")).toBe("hyrox");
    expect(splitsFor("hyrox").map((item) => item.id)).toEqual(["custom", "hyrox"]);
    expect(splitsFor("muscle").map((item) => item.id)).not.toContain("hyrox");
    expect(splitsFor("muscle").map((item) => item.id)).toContain("custom");
  });

  it("picks the split from the days, as the server does", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((days) => splitFor(days))).toEqual([
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
      easeIn: true, split: "full_body", warmUp: false, coolDown: true, blockWeeks: 6, startDate: "2026-11-25", updatedAt: "", workouts: [], lastPosition: null,
    };
    const answers = answersOf(plan);
    expect(answers).toEqual({ goal: "strength", weekdays: [1, 3], minutes: 45, experience: "new", equipment: ["dumbbells"], goEasy: ["wrists"], easeIn: true, split: "full_body", warmUp: false, coolDown: true });
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
    expect(planLine({ goal: "hyrox", split: "hyrox", weekdays: [0, 2, 4], minutes: 45 })).toBe("Hyrox · 3 days · 45 min");
  });

  it("counts a circuit in rounds", () => {
    const stations: PlanWorkout = {
      id: "s", name: "Stations A", minutes: 45,
      exercises: [
        { exerciseId: "run", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 0, metres: 1000, format: "for_time" },
        { exerciseId: "skierg", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 0, metres: 500, superset: true },
        { exerciseId: "wall-ball", sets: 2, repMin: 20, repMax: 20, seconds: null, restSeconds: 0, superset: true },
      ],
    };
    expect(workoutLine(stations)).toBe("3 exercises · 2 rounds · ~45 min");
    // A kettlebell finisher counts its minutes, not its sets.
    const finished: PlanWorkout = {
      ...workout("Full body A", [3, 3, 3], 45),
      exercises: [
        ...workout("x", [3, 3, 3]).exercises,
        { exerciseId: "kettlebell-swing", sets: 10, repMin: 15, repMax: 15, seconds: null, restSeconds: 0, format: "emom", minutes: 10 },
        { exerciseId: "pushups", sets: 10, repMin: 5, repMax: 5, seconds: null, restSeconds: 0, superset: true },
      ],
    };
    expect(workoutLine(finished)).toBe("5 exercises · 9 sets + EMOM 10 min · ~45 min");
    expect(finisherOf(finished)).toEqual({ at: 3, label: "EMOM 10 min" });
    expect(clockLabel({ format: "amrap", minutes: 8 })).toBe("AMRAP 8 min");
    expect(weekLine({ week: 2, rir: 2, lighter: false, workout: finished }, 6)).toBe("Week 2 of 6 · 2 reps in reserve");
    // Done on the clock, so no reps in reserve.
    expect(weekLine({ week: 1, rir: 3, lighter: false, workout: stations }, 6)).toBe("Week 1 of 6");
    expect(weekLine({ week: 1, rir: 3, lighter: false, workout: workout("Upper A", [3]) }, 6)).toBe("Week 1 of 6 · 3 reps in reserve");
  });

  it("sums the preview with rounded averages", () => {
    const summary = previewSummary({
      split: "upper_lower", easeIn: false, warmUp: false, coolDown: false, blockWeeks: 6,
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
    expect(prescription({ exerciseId: "run", sets: 4, repMin: null, repMax: null, seconds: null, restSeconds: 90, metres: 1000 })).toBe("4 × 1 km");
    expect(prescription({ exerciseId: "sled-push", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 0, metres: 25 })).toBe("2 × 25 m");
    expect(prescription({ exerciseId: "wall-ball", sets: 3, repMin: 20, repMax: 20, seconds: null, restSeconds: 0 })).toBe("3 × 20");
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
    expect(upNext({ ...easing, lastPosition: 23 })).toMatchObject({ block: 2, week: 1, rir: 3, easing: false });
    // Half load steps in the first two weeks only.
    expect([2, 3, 7].map((lastPosition) => upNext({ ...easing, lastPosition })!.easing)).toEqual([true, true, false]);
    expect(upNext(plan)!.easing).toBe(false);
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
    expect(target).toEqual({ repMin: 6, repMax: 10, seconds: null, metres: null, rir: 2, restSeconds: 120, easing: false });
    expect(targetLine(target)).toBe("6–10 reps · 2 in reserve");
    expect(targetLine({ ...target, repMin: null, repMax: null, seconds: 45 })).toBe("45 s hold");
    expect(targetLine({ ...target, repMin: null, repMax: null, metres: 1000 })).toBe("1 km");
    expect(targetLine({ ...target, repMin: 20, repMax: 20 })).toBe("20 reps · 2 in reserve");
    expect(targetLine(targetOf({ exerciseId: "wall-ball", sets: 3, repMin: 20, repMax: 20, seconds: null, restSeconds: 0, superset: true }, { rir: 2 })))
      .toBe("20 reps");
  });
});

describe("the plan's calendar", () => {
  const workouts = ["Upper A", "Lower A", "Upper B", "Lower B"].map((name) => workout(name, [3]));
  // Monday, Tuesday, Thursday, Friday. 25 Nov 2026 is a Wednesday.
  const plan = { workouts, weekdays: [0, 1, 3, 4] };

  it("reads a date's weekday from Monday", () => {
    expect(weekdayOf("2026-11-23")).toBe(0);
    expect(weekdayOf("2026-11-25")).toBe(2);
    expect(weekdayOf("2026-11-29")).toBe(6);
  });

  it("puts Up next on the first training day from today, and the rest on the days after", () => {
    const days = projectDays(plan, { position: 5 }, "2026-11-25", false, 4);
    expect(days.map((day) => [day.date, day.workout.name, day.position])).toEqual([
      ["2026-11-26", "Lower A", 5],
      ["2026-11-27", "Upper B", 6],
      ["2026-11-30", "Lower B", 7],
      ["2026-12-01", "Upper A", 8],
    ]);
  });

  it("starts today on a training day, and tomorrow once a plan workout is done today", () => {
    expect(projectDays(plan, { position: 0 }, "2026-11-26", false, 1)[0].date).toBe("2026-11-26");
    expect(projectDays(plan, { position: 1 }, "2026-11-26", true, 1)[0].date).toBe("2026-11-27");
    expect(projectDays({ ...plan, weekdays: [] }, { position: 0 }, "2026-11-26", false, 3)).toEqual([]);
  });

  it("names the day", () => {
    expect(dayLabel("2026-11-25", "2026-11-25")).toBe("Today");
    expect(dayLabel("2026-11-26", "2026-11-25")).toBe("Tomorrow");
    expect(dayLabel("2026-11-30", "2026-11-25")).toBe("Mon 30 Nov");
  });
});

describe("a new plan's preview", () => {
  it("gives each workout its days, the training days taking them in turn", () => {
    expect(workoutDays([4, 0, 2], 2)).toEqual([[0, 4], [2]]);
    // More workouts than days: the rest come the next week.
    expect(workoutDays([0, 3], 3)).toEqual([[0], [3], []]);
    expect(workoutDays([0], 0)).toEqual([]);
    expect(dayNames([0, 4])).toBe("Mon, Fri");
  });

  it("says how long each workout takes, or the time asked for while they're empty", () => {
    const workout = (minutes: number, count: number) => ({ minutes, exercises: Array.from({ length: count }, () => ({ exerciseId: "x", sets: 3, repMin: 6, repMax: 10, seconds: null, restSeconds: 90 })) });
    expect(eachMinutes([workout(50, 5), workout(60, 6)], 60)).toBe(55);
    expect(eachMinutes([workout(0, 0), workout(0, 0)], 45)).toBe(45);
  });

  it("says how the block runs", () => {
    expect(blockNote({ split: "full_body", easeIn: false, blockWeeks: 6 })).toBe("Each week adds a little, then week 6 is lighter so you recover.");
    expect(blockNote({ split: "upper_lower", easeIn: true, blockWeeks: 6 })).toMatch(/^The first 2 weeks ease in\. /);
    expect(blockNote({ split: "custom", easeIn: false, blockWeeks: 6 })).toMatch(/start empty/);
  });
});
