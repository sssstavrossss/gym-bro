import { describe, expect, it } from "vitest";
import {
  clock,
  currentExercise,
  emptySet,
  exerciseSummary,
  finished,
  formatSet,
  fromSaved,
  historyLine,
  shortDay,
  measureFields,
  parseField,
  restLeft,
  restSeconds,
  secondsDigits,
  setHints,
  swapExercise,
  toggleSet,
  toRequest,
  typeKey,
  undoneSets,
  workoutStatus,
  workoutTotals,
  type DraftExercise,
  type DraftWorkout,
  type SavedSet,
} from "../src/lib/workout";

const now = new Date("2026-11-25T17:30:00Z");

function saved(kg: number | null, reps: number | null, type: SavedSet["type"] = "working"): SavedSet {
  return { exerciseId: "barbell-squat", block: 0, type, kg, reps, rir: 2, seconds: null, metres: null, calories: null, doneAt: "2026-11-23T17:00:00Z" };
}

function exercise(key: string, sets = [emptySet(), emptySet()]): DraftExercise {
  return { key, exerciseId: "barbell-squat", sets };
}

function workout(exercises: DraftExercise[]): DraftWorkout {
  return { id: "w1", date: "2026-11-25", startedAt: "2026-11-25T17:00:00.000Z", endedAt: null, name: null, exercises, restEndsAt: null, restFor: 0 };
}

describe("measureFields", () => {
  it("asks for what each measure records, in typing order", () => {
    expect(measureFields("weight_reps")).toEqual(["kg", "reps", "rir"]);
    expect(measureFields("reps")).toEqual(["reps", "rir"]);
    expect(measureFields("time")).toEqual(["seconds"]);
    expect(measureFields("distance_time")).toEqual(["metres", "seconds"]);
    expect(measureFields("weight_distance")).toEqual(["kg", "metres"]);
  });
});

describe("hints and ticking", () => {
  const last = [saved(40, 10, "warmup"), saved(80, 8), saved(80, 7)];

  it("hints last time's matching working set, skipping warm-ups on both sides", () => {
    const squat = exercise("a", [emptySet("warmup"), emptySet(), emptySet(), emptySet()]);
    expect(setHints(squat, 1, last).kg).toBe(80);
    expect(setHints(squat, 2, last).reps).toBe(7);
    // Past the end of last time: its final set.
    expect(setHints(squat, 3, last).reps).toBe(7);
  });

  it("hints the set before once that one is done", () => {
    const squat = exercise("a", [{ ...emptySet(), kg: 85, reps: 6, rir: 1, doneAt: now.toISOString() }, emptySet()]);
    expect(setHints(squat, 1, last)).toMatchObject({ kg: 85, reps: 6, rir: 1 });
    expect(setHints(exercise("b"), 0, [])).toEqual({ kg: null, reps: null, rir: null, seconds: null, metres: null });
  });

  it("hints a plan circuit's distance and set reps, with no reps in reserve", () => {
    const target = { repMin: null, repMax: null, seconds: null, metres: 1000, rir: 2, restSeconds: 0, circuit: true };
    const run = { ...exercise("r", [emptySet()]), exerciseId: "run", target };
    expect(setHints(run, 0, [])).toMatchObject({ metres: 1000, rir: null });
    const wall = { ...exercise("w", [emptySet()]), exerciseId: "wall-ball", target: { ...target, metres: null, repMin: 20, repMax: 20 } };
    expect(setHints(wall, 0, [])).toMatchObject({ reps: 20, metres: null, rir: null });
  });

  it("hints the suggested weight on working sets until one is done today, and not after a warm-up", () => {
    const squat = exercise("a", [emptySet("warmup"), emptySet(), emptySet()]);
    const up = { kg: 82.5, reps: 6 };
    expect(setHints(squat, 0, last, up)).toMatchObject({ kg: 80, reps: 8 });
    expect(setHints(squat, 1, last, up)).toMatchObject({ kg: 82.5, reps: 6 });
    squat.sets[0] = { ...squat.sets[0], kg: 40, reps: 10, doneAt: now.toISOString() };
    expect(setHints(squat, 1, last, up)).toMatchObject({ kg: 82.5, reps: 6 });
    // A hold keeps last time's reps.
    expect(setHints(squat, 2, last, { kg: 80, reps: null })).toMatchObject({ kg: 80, reps: 7 });
    squat.sets[1] = { ...squat.sets[1], kg: 85, reps: 5, doneAt: now.toISOString() };
    expect(setHints(squat, 2, last, up)).toMatchObject({ kg: 85, reps: 5 });
  });

  it("ticking fills empty fields from hints and keeps typed ones; ticking again undoes it", () => {
    const typed = { ...emptySet(), reps: 9 };
    const done = toggleSet(typed, { kg: 80, reps: 8, rir: 2, seconds: null, metres: null }, ["kg", "reps", "rir"], now);
    expect(done).toMatchObject({ kg: 80, reps: 9, rir: 2, doneAt: now.toISOString() });
    expect(toggleSet(done, { kg: 1, reps: 1, rir: 1, seconds: null, metres: null }, ["kg", "reps", "rir"], now)).toMatchObject({ kg: 80, reps: 9, doneAt: null });
  });
});

describe("totals and finishing", () => {
  const done = now.toISOString();
  const draft = workout([
    exercise("a", [{ ...emptySet("warmup"), kg: 40, reps: 10, doneAt: done }, { ...emptySet(), kg: 80, reps: 8, doneAt: done }, emptySet()]),
    exercise("b", [emptySet()]),
  ]);

  it("counts ticked sets that aren't warm-ups", () => {
    expect(workoutTotals(draft)).toEqual({ sets: 1, plannedSets: 3, volumeKg: 640, metres: 0 });
    expect(undoneSets(draft)).toBe(2);
    expect(currentExercise(draft)).toBe("a");
  });

  it("Finish keeps only ticked sets and drops empty exercises", () => {
    const end = finished(draft, now);
    expect(end.endedAt).toBe(now.toISOString());
    expect(end.exercises.map((e) => e.key)).toEqual(["a"]);
    expect(end.exercises[0].sets).toHaveLength(2);
  });

  it("sends each exercise as its own block, sets in order", () => {
    const body = toRequest(workout([exercise("a", [{ ...emptySet(), kg: 80, reps: 8, doneAt: done }]), { key: "b", exerciseId: "pullups", sets: [{ ...emptySet(), reps: 10, doneAt: done }] }]), "Europe/Oslo");
    expect(body).toMatchObject({ date: "2026-11-25", timeZone: "Europe/Oslo", kind: null, status: "done" });
    expect(body.sets.map((set) => [set.exerciseId, set.block, set.kg, set.reps])).toEqual([["barbell-squat", 0, 80, 8], ["pullups", 1, null, 10]]);
  });
});

describe("rest", () => {
  const base = { category: "strength", measure: "weight_reps" as const, primaryMuscles: ["quadriceps"] };
  it("rests longest after heavy leg compounds, none after cardio", () => {
    expect(restSeconds({ ...base, mechanic: "compound" })).toBe(180);
    expect(restSeconds({ ...base, mechanic: "compound", primaryMuscles: ["chest"] })).toBe(120);
    expect(restSeconds({ ...base, mechanic: "isolation", primaryMuscles: ["biceps"] })).toBe(90);
    expect(restSeconds({ ...base, category: "cardio", mechanic: null, measure: "distance_time" })).toBe(0);
    expect(restSeconds({ ...base, mechanic: null, measure: "time" })).toBe(0);
  });

  it("counts down to zero", () => {
    expect(restLeft({ restEndsAt: null }, now.getTime())).toBeNull();
    expect(restLeft({ restEndsAt: "2026-11-25T17:31:30Z" }, now.getTime())).toBe(90);
    expect(restLeft({ restEndsAt: "2026-11-25T17:29:00Z" }, now.getTime())).toBe(0);
  });
});

describe("words and typing", () => {
  it("writes sets the way each measure reads", () => {
    const set = { kg: 82.5, reps: 8, rir: 2, seconds: 90, metres: 500 };
    expect(formatSet(set, "weight_reps")).toBe("82.5 × 8");
    expect(formatSet({ ...set, kg: null }, "weight_reps")).toBe("8 reps");
    expect(formatSet(set, "reps")).toBe("8 reps");
    expect(formatSet(set, "time")).toBe("1:30");
    expect(formatSet(set, "distance_time")).toBe("500 m · 1:30");
    expect(formatSet({ ...set, metres: 20 }, "weight_distance")).toBe("82.5 kg · 20 m");
    expect(formatSet({ kg: null, reps: null, rir: null, seconds: null, metres: null }, "time")).toBe("—");
    expect(clock(3723)).toBe("1:02:03");
  });

  it("reads typed numbers within the API's limits", () => {
    expect(parseField("kg", "82.5")).toBe(82.5);
    expect(parseField("kg", "82,25")).toBe(82.25);
    expect(parseField("reps", "8.5")).toBeUndefined();
    expect(parseField("rir", "11")).toBeUndefined();
    expect(parseField("reps", "")).toBeNull();
    expect(parseField("seconds", "130")).toBe(90);
    expect(parseField("seconds", "45")).toBe(45);
    expect(secondsDigits(90)).toBe("130");
    expect(secondsDigits(45)).toBe("45");
    expect(secondsDigits(3661)).toBe("10101");
  });

  it("types on the app keypad: one point for kg, none for reps, and nothing past a limit", () => {
    expect(typeKey("82", ".", "kg")).toBe("82.");
    expect(typeKey("82.", ".", "kg")).toBe("82.");
    expect(typeKey("8", ".", "reps")).toBe("8");
    expect(typeKey("", ".", "kg")).toBe("0.");
    expect(typeKey("0", "5", "reps")).toBe("5");
    expect(typeKey("10", "1", "rir")).toBe("10");
    expect(typeKey("82.5", "⌫", "kg")).toBe("82.");
  });
});

describe("exerciseSummary", () => {
  const done = (kg: number | null, reps: number, type: "working" | "warmup" = "working") =>
    ({ ...emptySet(type), kg, reps, doneAt: now.toISOString() });

  it("says the weight once when it held, and leaves out warm-ups and undone sets", () => {
    expect(exerciseSummary([done(40, 10, "warmup"), done(80, 10), done(80, 10), done(80, 9), emptySet()], "weight_reps")).toBe("80 kg × 10, 10, 9");
  });

  it("lists each set when the weight changed, and is empty when nothing is done", () => {
    expect(exerciseSummary([done(80, 10), done(82.5, 8)], "weight_reps")).toBe("80 × 10, 82.5 × 8");
    expect(exerciseSummary([done(null, 12)], "reps")).toBe("12 reps");
    expect(exerciseSummary([emptySet()], "weight_reps")).toBe("");
  });
});

describe("workoutStatus", () => {
  it("shows the time it has run and the sets ticked off", () => {
    const one = workout([exercise("e1", [{ ...emptySet(), doneAt: now.toISOString() }])]);
    expect(workoutStatus(one, now.getTime())).toBe("30:00 · 1 of 1 set");
    expect(workoutStatus(workout([exercise("e1")]), now.getTime() + 3_600_000)).toBe("1:30:00 · 0 of 2 sets");
  });
});

describe("past workouts", () => {
  it("turns a saved workout back into exercises by block, keeping the same exercise twice apart", () => {
    const draft = fromSaved({
      id: "w9", date: "2026-11-23", name: null, startedAt: null, endedAt: null,
      sets: [saved(60, 10), saved(60, 9), { ...saved(20, 12), exerciseId: "plank", block: 1 }, { ...saved(70, 5), block: 2 }],
    });
    expect(draft.exercises.map((e) => [e.key, e.exerciseId, e.sets.length])).toEqual([["e1", "barbell-squat", 2], ["e2", "plank", 1], ["e3", "barbell-squat", 1]]);
    expect(draft.exercises[0].sets[1]).toMatchObject({ kg: 60, reps: 9, type: "working", doneAt: "2026-11-23T17:00:00Z" });
    expect(toRequest(draft, "Europe/Oslo").sets.map((set) => set.block)).toEqual([0, 0, 1, 2]);
  });

  it("names the day and sums up a history row", () => {
    expect(shortDay("2026-11-23")).toBe("Mon 23 Nov");
    const name = (id: string) => ({ a: "Squat", b: "Bench", c: "Row", d: "Curl" })[id] ?? id;
    expect(historyLine({ exercises: ["a", "b", "c", "d"], sets: 12, volumeKg: 4560.5 }, name)).toBe("Squat, Bench +2 · 12 sets · 4,561 kg");
    expect(historyLine({ exercises: ["a"], sets: 1, volumeKg: 0 }, name)).toBe("Squat · 1 set");
  });

  it("keeps a plan workout's link through an edit, and saves a skipped one as skipped", () => {
    const draft = fromSaved({
      id: "w", date: "2026-11-25", name: "Upper A", startedAt: null, endedAt: null, sets: [], status: "skipped", planWorkoutId: "p1", sequencePosition: 4,
    });
    expect(draft.plan).toEqual({ workoutId: "p1", position: 4 });
    const body = toRequest(draft, "UTC");
    expect(body).toMatchObject({ status: "skipped", planWorkoutId: "p1", sequencePosition: 4 });
    // Sets added to a skipped workout make it done.
    draft.exercises.push({ key: "e1", exerciseId: "a", sets: [{ ...emptySet(), reps: 5, doneAt: "2026-11-25T10:00:00Z" }] });
    expect(toRequest(draft, "UTC").status).toBe("done");
    expect(historyLine({ exercises: [], sets: 0, volumeKg: 0, status: "skipped" }, (id) => id)).toBe("Skipped");
  });

  it("hints this week's reps in reserve and a hold's target from the plan", () => {
    const exercise = { key: "e1", exerciseId: "a", sets: [emptySet()], target: { repMin: 6, repMax: 10, seconds: null, rir: 2, restSeconds: 120 } };
    const last = [{ exerciseId: "a", block: 0, type: "working" as const, kg: 80, reps: 8, rir: 3, seconds: null, metres: null, calories: null, doneAt: null }];
    expect(setHints(exercise, 0, last)).toMatchObject({ kg: 80, reps: 8, rir: 2 });
    const hold = { ...exercise, target: { ...exercise.target, repMin: null, repMax: null, seconds: 45 } };
    expect(setHints(hold, 0, [])).toMatchObject({ seconds: 45 });
  });
});

describe("swapping an exercise", () => {
  const target = { repMin: 6, repMax: 10, seconds: null, rir: 2, restSeconds: 180, easing: false };
  const done = { ...emptySet(), kg: 100, reps: 8, doneAt: "2026-11-25T18:00:00Z" };

  it("moves every set, emptied, when nothing is ticked, and keeps the target", () => {
    const from = { key: "e1", exerciseId: "barbell-squat", target, sets: [emptySet("warmup"), { ...emptySet(), kg: 100 }, emptySet()] };
    const { keep, next } = swapExercise(from, "leg-press", "e9");
    expect(keep).toBeNull();
    expect(next).toEqual({ key: "e1", exerciseId: "leg-press", target, sets: [emptySet("warmup"), emptySet(), emptySet()] });
  });

  it("leaves ticked sets with the old exercise and moves the rest", () => {
    const from = { key: "e1", exerciseId: "barbell-squat", sets: [done, emptySet(), emptySet()] };
    const { keep, next } = swapExercise(from, "leg-press", "e9");
    expect(keep).toEqual({ ...from, sets: [done] });
    expect(next).toEqual({ key: "e9", exerciseId: "leg-press", target: null, sets: [emptySet(), emptySet()] });
  });

  it("gives as many sets again when all were ticked", () => {
    const { next } = swapExercise({ key: "e1", exerciseId: "barbell-squat", sets: [done, done] }, "leg-press", "e9");
    expect(next.sets).toEqual([emptySet(), emptySet()]);
  });
});
