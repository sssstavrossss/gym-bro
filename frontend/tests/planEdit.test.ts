import { describe, expect, it } from "vitest";
import type { ExerciseItem } from "../src/lib/exercises";
import type { PlanExercise } from "../src/lib/plan";
import {
  defaultPrescription,
  estimateMinutes,
  moved,
  prescribedBy,
  restLine,
  sameExercises,
  stepReps,
  stepRest,
  stepSeconds,
  stepSets,
  movedExercise,
  removed,
  tidyCircuits,
  workSeconds,
} from "../src/lib/planEdit";

const item = (over: Partial<ExerciseItem>): ExerciseItem => ({
  id: "barbell-squat", name: "Barbell Squat", category: "strength", equipment: "barbell", level: "beginner",
  mechanic: "compound", force: "push", measure: "weight_reps", primaryMuscles: ["quadriceps"], secondaryMuscles: [], images: 2, ...over,
});
const plan = { goal: "muscle" as const, experience: "some" as const, minutes: 60 };
const lift: PlanExercise = { exerciseId: "barbell-squat", sets: 3, repMin: 6, repMax: 10, seconds: null, restSeconds: 180 };

describe("defaultPrescription", () => {
  it("gives a lift the goal's range, sets by experience and the usual rest", () => {
    expect(defaultPrescription(item({}), plan)).toEqual(lift);
    expect(defaultPrescription(item({}), { ...plan, experience: "experienced", goal: "strength" })).toMatchObject({ sets: 4, repMin: 6, repMax: 8 });
    const curl = item({ id: "curl", mechanic: "isolation", primaryMuscles: ["biceps"] });
    expect(defaultPrescription(curl, { ...plan, experience: "new" })).toMatchObject({ sets: 2, repMin: 10, repMax: 15, restSeconds: 90 });
    expect(defaultPrescription(curl, { ...plan, goal: "fitness" })).toMatchObject({ repMin: 12, repMax: 15, restSeconds: 60 });
  });

  it("gives a hold seconds, body weight a higher range, and cardio one set", () => {
    expect(defaultPrescription(item({ id: "plank", measure: "time", mechanic: null }), plan)).toEqual(
      { exerciseId: "plank", sets: 3, repMin: null, repMax: null, seconds: 45, restSeconds: 60 });
    expect(defaultPrescription(item({ id: "push-up", measure: "reps", primaryMuscles: ["chest"] }), plan)).toMatchObject({ repMin: 8, repMax: 15 });
    expect(defaultPrescription(item({ id: "run", measure: "distance_time", category: "cardio" }), plan)).toEqual(
      { exerciseId: "run", sets: 1, repMin: null, repMax: null, seconds: null, restSeconds: 0 });
  });

  it("keeps to 2 sets in a short plan", () => {
    expect(defaultPrescription(item({}), { ...plan, minutes: 20 }).sets).toBe(2);
  });
});

describe("steppers", () => {
  it("keeps sets between 1 and 10", () => {
    expect(stepSets({ ...lift, sets: 1 }, -1).sets).toBe(1);
    expect(stepSets({ ...lift, sets: 10 }, 1).sets).toBe(10);
    expect(stepSets(lift, 1).sets).toBe(4);
  });

  it("pushes the other end of the rep range along", () => {
    expect(stepReps({ ...lift, repMin: 10, repMax: 10 }, "low", 1)).toMatchObject({ repMin: 11, repMax: 11 });
    expect(stepReps({ ...lift, repMin: 6, repMax: 6 }, "high", -1)).toMatchObject({ repMin: 5, repMax: 5 });
    expect(stepReps({ ...lift, repMin: 1 }, "low", -1).repMin).toBe(1);
    expect(stepReps({ ...lift, repMax: 50 }, "high", 1).repMax).toBe(50);
  });

  it("steps holds and rest by 15 seconds on the grid", () => {
    const hold = { ...lift, repMin: null, repMax: null, seconds: 45 };
    expect(stepSeconds(hold, 1).seconds).toBe(60);
    expect(stepSeconds({ ...hold, seconds: 50 }, -1).seconds).toBe(45);
    expect(stepSeconds({ ...hold, seconds: 15 }, -1).seconds).toBe(5);
    expect(stepSeconds({ ...hold, seconds: 600 }, 1).seconds).toBe(600);
    expect(stepRest(lift, 1).restSeconds).toBe(195);
    expect(stepRest({ ...lift, restSeconds: 0 }, -1).restSeconds).toBe(0);
    expect(stepRest({ ...lift, restSeconds: 600 }, 1).restSeconds).toBe(600);
  });
});

describe("moved", () => {
  it("swaps with the neighbour, and stays put at the ends", () => {
    expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("estimateMinutes", () => {
  it("matches the server's estimate", () => {
    const plank = { exerciseId: "plank", sets: 3, repMin: null, repMax: null, seconds: 45, restSeconds: 60 };
    const squat = { ...lift, sets: 5, repMin: 3, repMax: 5 };
    const run = { exerciseId: "run", sets: 1, repMin: null, repMax: null, seconds: null, restSeconds: 0 };
    expect(estimateMinutes([plank, squat, run], 60)).toBe(30);
    expect(estimateMinutes([], 20)).toBe(5);
  });

  it("counts an EMOM or AMRAP by its minutes", () => {
    const swing = { exerciseId: "kettlebell-swing", sets: 10, repMin: 15, repMax: 15, seconds: null, restSeconds: 0, format: "emom" as const, minutes: 10 };
    const pushups = { exerciseId: "pushups", sets: 10, repMin: 5, repMax: 5, seconds: null, restSeconds: 0, superset: true };
    // 5 min warm-up, 3 × (40 s + 3 min) + 1 min, then 10 min and a minute: 28 min, to the nearest 5.
    expect(estimateMinutes([lift, swing, pushups], 45)).toBe(30);
    expect(sameExercises([swing], [{ ...swing, minutes: 12 }])).toBe(false);
  });

  it("counts a distance's time as the server does", () => {
    const run = { exerciseId: "run", sets: 1, repMin: null, repMax: null, seconds: null, restSeconds: 0 };
    expect(workSeconds({ ...run, metres: 1000 })).toBe(300);
    expect(workSeconds({ ...run, metres: 25 })).toBe(57);
    expect(workSeconds(run)).toBe(40);
    // 5 min warm-up, 4 × (5 min + 90 s) and a minute's changeover: 32 min, to the nearest 5.
    expect(estimateMinutes([{ ...run, sets: 4, metres: 1000, restSeconds: 90 }], 45)).toBe(30);
  });
});

describe("tidyCircuits", () => {
  const run: PlanExercise = { exerciseId: "run", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 0, metres: 1000, format: "for_time" };
  const ski: PlanExercise = { exerciseId: "skierg", sets: 2, repMin: null, repMax: null, seconds: null, restSeconds: 0, metres: 500, superset: true };
  const wall: PlanExercise = { exerciseId: "wall-ball", sets: 2, repMin: 20, repMax: 20, seconds: null, restSeconds: 0, superset: true };

  it("hands the clock on when the circuit's first exercise goes", () => {
    const [first, second] = removed([run, ski, wall], 0);
    expect(first).toMatchObject({ exerciseId: "skierg", superset: false, format: "for_time" });
    expect(second).toMatchObject({ exerciseId: "wall-ball", superset: true });
    // One from the middle leaves the rest joined.
    expect(removed([run, ski, wall], 1).map((item) => item.exerciseId)).toEqual(["run", "wall-ball"]);
    expect(removed([run, ski, wall], 1)[0].format).toBe("for_time");
  });

  it("only reorders inside a circuit: the join and the clock stay in place", () => {
    const next = movedExercise([run, ski, wall], 0, 1);
    expect(next.map((item) => [item.exerciseId, !!item.superset, item.format ?? null])).toEqual([
      ["skierg", false, "for_time"], ["run", true, null], ["wall-ball", true, null],
    ]);
    expect(movedExercise([run, ski, wall], 2, 1)).toEqual([run, ski, wall]);
  });

  it("moves out of a circuit on its own, and the circuit keeps its clock", () => {
    const next = movedExercise([lift, run, ski, wall], 1, -1);
    expect(next.map((item) => [item.exerciseId, !!item.superset, item.format ?? null])).toEqual([
      ["run", false, null], ["barbell-squat", false, null], ["skierg", false, "for_time"], ["wall-ball", true, null],
    ]);
    const down = movedExercise([run, ski, wall, lift], 2, 1);
    expect(down.map((item) => [item.exerciseId, !!item.superset, item.format ?? null])).toEqual([
      ["run", false, "for_time"], ["skierg", true, null], ["barbell-squat", false, null], ["wall-ball", false, null],
    ]);
  });

  it("leaves a whole circuit as it is", () => {
    expect(tidyCircuits([run, ski, wall])).toEqual([run, ski, wall]);
  });
});

describe("lines and checks", () => {
  it("says the rest", () => {
    expect(restLine(90)).toBe("Rest 1:30");
    expect(restLine(0)).toBe("No rest");
  });

  it("tells what's prescribed by what", () => {
    expect(prescribedBy("weight_reps")).toBe("reps");
    expect(prescribedBy("time")).toBe("seconds");
    expect(prescribedBy("weight_distance")).toBe("none");
  });

  it("spots a change", () => {
    expect(sameExercises([lift], [{ ...lift }])).toBe(true);
    expect(sameExercises([lift], [{ ...lift, sets: 4 }])).toBe(false);
    expect(sameExercises([lift], [])).toBe(false);
    expect(sameExercises([lift], [{ ...lift, superset: false, metres: null, format: null }])).toBe(true);
    expect(sameExercises([lift], [{ ...lift, metres: 800 }])).toBe(false);
    expect(sameExercises([lift], [{ ...lift, superset: true }])).toBe(false);
  });
});
