import { describe, expect, it } from "vitest";
import type { ExerciseMeasure } from "../src/lib/exercises";
import { nextSet, timelineRows } from "../src/lib/timeline";
import { moveExercise, moveSet, setUnit, type MoveContext, type MoveVerdict } from "../src/lib/timelineMove";
import { emptySet, fromSaved, toRequest, type DraftExercise, type DraftSet, type DraftWorkout } from "../src/lib/workout";

const at = (minute: number) => `2026-11-28T10:${String(minute).padStart(2, "0")}:00Z`;
const done = (kg: number, reps: number, minute: number, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps, doneAt: at(minute) });
const todo = (kg: number | null = null, reps: number | null = null, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps });
const ex = (key: string, sets: DraftSet[], more: Partial<DraftExercise> = {}): DraftExercise => ({ key, exerciseId: key, sets, ...more });

const MEASURES: Record<string, ExerciseMeasure> = { plank: "time", run: "distance_time" };
const NAMES: Record<string, string> = { press: "Leg Press", hack: "Hack Squat", curl: "Curl", push: "Pushdown", plank: "Plank", run: "Run", calf: "Calf Raise", stretch: "Hip Stretch" };
const context: MoveContext = { nameOf: (id) => NAMES[id] ?? id, measureOf: (id) => MEASURES[id] ?? "weight_reps" };

const ok = (verdict: MoveVerdict) => {
  if (!verdict.ok) throw new Error(`blocked: ${verdict.reason}`);
  return verdict;
};
const blocked = (verdict: MoveVerdict) => {
  if (verdict.ok) throw new Error("expected the move to be blocked");
  return verdict.reason;
};
const shape = (exercise: DraftExercise | undefined) => exercise?.sets.map((set) => `${set.type[0]}${set.kg ?? ""}${set.doneAt ? "✓" : ""}`).join(" ");
const order = (exercises: DraftExercise[]) => exercises.map((exercise) => `${exercise.superset ? "+" : ""}${exercise.key}`).join(" ");

describe("what a drag picks up", () => {
  it("a working set takes its drop sets; a warm-up or a drop set goes alone", () => {
    const sets = [todo(20, 8, "warmup"), todo(100, 8), todo(80, 8, "drop"), todo(60, 8, "drop"), todo(100, 8)];
    expect(setUnit(sets, 1)).toEqual({ start: 1, end: 4 });
    expect(setUnit(sets, 0)).toEqual({ start: 0, end: 1 });
    expect(setUnit(sets, 2)).toEqual({ start: 2, end: 3 });
    expect(setUnit(sets, 4)).toEqual({ start: 4, end: 5 });
  });
});

describe("moving a set within its exercise", () => {
  it("reorders sets not done yet without asking", () => {
    const press = ex("press", [todo(100), todo(110), todo(120)]);
    const verdict = ok(moveSet([press], { key: "press", index: 2 }, { key: "press", at: 0 }, context));
    expect(verdict.ask).toBeNull();
    expect(shape(verdict.exercises[0])).toBe("w120 w100 w110");
  });

  it("moves a working set with its drop sets as one block, and never into another set's drop sets", () => {
    const press = ex("press", [todo(100), todo(120), todo(90, null, "drop"), todo(70, null, "drop")]);
    expect(shape(ok(moveSet([press], { key: "press", index: 1 }, { key: "press", at: 0 }, context)).exercises[0])).toBe("w120 d90 d70 w100");
    const two = ex("press", [todo(100), todo(80, null, "drop"), todo(120)]);
    expect(blocked(moveSet([two], { key: "press", index: 2 }, { key: "press", at: 1 }, context))).toMatch(/drop sets/);
  });

  it("reorders drop sets within their block, but not out of it", () => {
    const press = ex("press", [todo(120), todo(90, null, "drop"), todo(70, null, "drop"), todo(100)]);
    expect(shape(ok(moveSet([press], { key: "press", index: 2 }, { key: "press", at: 1 }, context)).exercises[0])).toBe("w120 d70 d90 w100");
    expect(blocked(moveSet([press], { key: "press", index: 1 }, { key: "press", at: 3 }, context))).toMatch(/stays with the set it drops from/);
    expect(blocked(moveSet([press], { key: "press", index: 1 }, { key: "press", at: 0 }, context))).toMatch(/stays with the set it drops from/);
  });

  it("asks before a set crosses between the warm-ups and the working sets, and changes its type", () => {
    const press = ex("press", [todo(20, 8, "warmup"), todo(40, 5, "warmup"), todo(100, 8), todo(100, 8)]);
    const up = ok(moveSet([press], { key: "press", index: 2 }, { key: "press", at: 1 }, context));
    expect(up.ask).toMatchObject({ title: "Make 100 kg × 8 a warm-up?", action: "Make it a warm-up" });
    expect(shape(up.exercises[0])).toBe("w20 w100 w40 w100");
    const down = ok(moveSet([press], { key: "press", index: 0 }, { key: "press", at: 3 }, context));
    expect(down.ask?.title).toBe("Make 20 kg × 8 a working set?");
    expect(shape(down.exercises[0])).toBe("w40 w100 w100 w20");
  });

  it("keeps a set what it was on the line between the warm-ups and the working sets", () => {
    const press = ex("press", [todo(20, 8, "warmup"), todo(100, 8), todo(110, 8)]);
    // The last warm-up dragged to just above the first working set, and a working set to just below the warm-ups.
    expect(ok(moveSet([press], { key: "press", index: 0 }, { key: "press", at: 0 }, context)).ask).toBeNull();
    const verdict = ok(moveSet([press], { key: "press", index: 2 }, { key: "press", at: 1 }, context));
    expect(verdict.ask).toBeNull();
    expect(shape(verdict.exercises[0])).toBe("w20 w110 w100");
  });

  it("won't make a set with drop sets a warm-up", () => {
    const press = ex("press", [todo(20, 8, "warmup"), todo(100, 8), todo(80, 8, "drop")]);
    expect(blocked(moveSet([press], { key: "press", index: 1 }, { key: "press", at: 0 }, context))).toMatch(/can't be a warm-up/);
  });

  it("keeps done sets in the order they were done, and nothing goes above them", () => {
    const press = ex("press", [done(20, 8, 0, "warmup"), done(100, 8, 2), done(100, 8, 5), todo(100), todo(100)]);
    // Done ones don't move: the rests between them and their tick times read that order as time.
    expect(blocked(moveSet([press], { key: "press", index: 2 }, { key: "press", at: 1 }, context))).toMatch(/order you did them/);
    // One not done can't go above one that is: it would be the set to do, behind sets already done.
    expect(blocked(moveSet([press], { key: "press", index: 3 }, { key: "press", at: 1 }, context))).toMatch(/stay first/);
    // Warm-ups and working sets keep their own order: a warm-up added after a working set is done can still take one in.
    const late = ex("press", [todo(40, 5, "warmup"), done(100, 8, 2), todo(100)]);
    expect(ok(moveSet([late], { key: "press", index: 2 }, { key: "press", at: 0 }, context)).ask?.action).toBe("Make it a warm-up");
  });

  it("leaves sets on a clock alone", () => {
    const emom = ex("press", [todo(), todo()], { timed: { format: "emom", minutes: 10, every: 1, startedAt: null, endedAt: null } as DraftExercise["timed"] });
    expect(blocked(moveSet([emom], { key: "press", index: 1 }, { key: "press", at: 0 }, context))).toMatch(/clock/);
  });
});

describe("moving a set to another exercise", () => {
  it("asks, and carries a set not done yet to where it's dropped", () => {
    const press = ex("press", [todo(100), todo(100)]);
    const hack = ex("hack", [todo(60), todo(60)]);
    const verdict = ok(moveSet([press, hack], { key: "press", index: 1 }, { key: "hack", at: 0 }, context));
    expect(verdict.ask).toMatchObject({ title: "Move 100 kg to Hack Squat?", action: "Move" });
    expect(shape(verdict.exercises[0])).toBe("w100");
    expect(shape(verdict.exercises[1])).toBe("w100 w60 w60");
  });

  it("says a done set now counts for the other exercise, and puts it in by the time it was done", () => {
    const press = ex("press", [done(100, 8, 2), done(100, 8, 9)]);
    const hack = ex("hack", [done(60, 10, 4), done(60, 10, 12), todo(60)]);
    const verdict = ok(moveSet([press, hack], { key: "press", index: 1 }, { key: "hack", at: 0 }, context));
    expect(verdict.ask?.title).toBe("Move 100 kg × 8 to Hack Squat?");
    expect(verdict.ask?.body).toMatch(/counts for Hack Squat from now on: its bests/);
    expect(verdict.exercises[1].sets.map((set) => set.doneAt)).toEqual([at(4), at(9), at(12), null]);
  });

  it("won't put a set where the numbers mean something else", () => {
    const press = ex("press", [todo(100, 8)]);
    const plank = ex("plank", [todo()]);
    expect(blocked(moveSet([press, plank], { key: "press", index: 0 }, { key: "plank", at: 0 }, context))).toMatch(/logged differently/);
  });

  it("takes an exercise left with no sets off, and says so; a superset it led stays together", () => {
    const press = ex("press", [todo(100, 8)]);
    const curl = ex("curl", [todo(14)]);
    const push = ex("push", [todo(30)], { superset: true });
    const hack = ex("hack", [todo(60)]);
    const verdict = ok(moveSet([curl, push, hack, press], { key: "curl", index: 0 }, { key: "hack", at: 1 }, context));
    expect(verdict.ask?.body).toMatch(/Curl has no sets left, so it comes off the workout/);
    expect(order(verdict.exercises)).toBe("push hack press");
  });

  it("moves a drop set only with its working set", () => {
    const press = ex("press", [todo(120), todo(90, null, "drop")]);
    const hack = ex("hack", [todo(60)]);
    expect(blocked(moveSet([press, hack], { key: "press", index: 1 }, { key: "hack", at: 1 }, context))).toMatch(/drops from/);
    const whole = ok(moveSet([press, hack], { key: "press", index: 0 }, { key: "hack", at: 1 }, context));
    expect(whole.exercises.map(shape)).toEqual(["w60 w120 d90"]);
  });
});

describe("moving an exercise", () => {
  const plain = () => [ex("press", [done(100, 8, 2)]), ex("hack", [todo()]), ex("calf", [todo()]), ex("curl", [todo()])];

  it("reorders what's ahead without asking", () => {
    const verdict = ok(moveExercise(plain(), { key: "curl", whole: true, at: 1 }, context));
    expect(verdict.ask).toBeNull();
    expect(order(verdict.exercises)).toBe("press curl hack calf");
  });

  it("keeps started exercises in the order they were done, and nothing goes above them", () => {
    expect(blocked(moveExercise(plain(), { key: "press", whole: true, at: 2 }, context))).toMatch(/started/);
    expect(blocked(moveExercise(plain(), { key: "calf", whole: true, at: 0 }, context))).toMatch(/done stay first/);
  });

  it("moves a superset whole, and asks before taking one exercise out of it", () => {
    const list = [ex("hack", [todo()]), ex("curl", [todo()]), ex("push", [todo()], { superset: true })];
    expect(order(ok(moveExercise(list, { key: "curl", whole: true, at: 0 }, context)).exercises)).toBe("curl +push hack");
    const out = ok(moveExercise(list, { key: "curl", whole: false, at: 0 }, context));
    expect(out.ask).toMatchObject({ title: "Take Curl out of the superset?", action: "Take it out" });
    expect(order(out.exercises)).toBe("curl hack push");
  });

  it("asks before joining a superset, and offers just moving it there instead", () => {
    const list = [ex("hack", [todo()]), ex("curl", [todo()]), ex("push", [todo()])];
    const verdict = ok(moveExercise(list, { key: "push", whole: true, at: 1, join: true }, context));
    expect(verdict.ask).toMatchObject({ title: "Superset Pushdown with Curl?", action: "Superset" });
    expect(order(verdict.exercises)).toBe("hack curl +push");
    expect(order(verdict.ask!.alternative!.exercises)).toBe("hack curl push");
    const circuit = ok(moveExercise([...list.slice(0, 2), { ...list[2], superset: true }, ex("calf", [todo()])], { key: "calf", whole: true, at: 1, join: true }, context));
    expect(circuit.ask?.title).toBe("Make a circuit of Curl, Pushdown and Calf Raise?");
  });

  it("won't join a superset that would pair done sets with sets not done", () => {
    const list = [ex("hack", [done(60, 10, 3)]), ex("curl", [todo()])];
    expect(blocked(moveExercise(list, { key: "curl", whole: true, at: 0, join: true }, context))).toMatch(/started can't join/);
  });

  it("won't superset an exercise with itself: saved, the two would come back as one", () => {
    const list = [ex("a", [todo(100)], { exerciseId: "press" }), ex("b", [todo(100)], { exerciseId: "press" })];
    expect(blocked(moveExercise(list, { key: "b", whole: true, at: 0, join: true }, context))).toMatch(/together with itself/);
    // Why: a superset saves as one block, and loading splits a block where the exercise changes. One that ends up
    // joined to itself anyway is split off when saved, so it comes back as two exercises, not one.
    const joined: DraftWorkout = {
      id: "w", date: "2026-11-28", startedAt: null, endedAt: null, name: null, restEndsAt: null, restFor: 0,
      exercises: [list[0], { ...list[1], superset: true }].map((exercise) => ({ ...exercise, sets: [done(100, 8, 1)] })),
    };
    const body = toRequest(joined, "Europe/Oslo");
    const back = fromSaved({ id: "w", date: "2026-11-28", name: null, startedAt: null, endedAt: null, sets: body.sets.map((set) => ({ ...set, kg: set.kg ?? null })) as never });
    expect(back.exercises.map((exercise) => [exercise.exerciseId, !!exercise.superset])).toEqual([["press", false], ["press", false]]);
  });

  it("won't join across the warm-up, the workout and the cool-down, or into a block on a clock", () => {
    const parts = [ex("stretch", [todo()], { part: "warmup" }), ex("hack", [todo()])];
    expect(blocked(moveExercise(parts, { key: "hack", whole: true, at: 0, join: true }, context))).toMatch(/stays within/);
    const clocked = [ex("hack", [todo()], { timed: { format: "amrap", minutes: 10, every: 1, startedAt: null, endedAt: null } as DraftExercise["timed"] }), ex("curl", [todo()])];
    expect(blocked(moveExercise(clocked, { key: "curl", whole: true, at: 0, join: true }, context))).toMatch(/clock/);
  });

  it("asks before moving into another part of the workout, and keeps its own part on the line between two", () => {
    const list = [ex("stretch", [todo()], { part: "warmup" }), ex("hack", [todo()]), ex("calf", [todo()]), ex("plank", [todo()], { part: "cooldown" })];
    const into = ok(moveExercise(list, { key: "stretch", whole: true, at: 2 }, context));
    expect(into.ask?.title).toBe("Move Hip Stretch to the workout?");
    expect(into.exercises.find((exercise) => exercise.key === "stretch")?.part).toBeUndefined();
    // Next to another warm-up, a warm-up stays one; dropped back where it was, nothing happens.
    const two = [ex("arms", [todo()], { part: "warmup" }), ...list];
    expect(ok(moveExercise(two, { key: "stretch", whole: true, at: 0 }, context)).ask).toBeNull();
    expect(ok(moveExercise(list, { key: "stretch", whole: true, at: 0 }, context)).ask).toBeNull();
    const cool = ok(moveExercise(list, { key: "hack", whole: true, at: 2 }, context));
    expect(cool.ask).toBeNull();
    expect(order(cool.exercises)).toBe("stretch calf hack plank");
  });

  it("goes in the part of the heading it's dropped under, between two parts", () => {
    const list = [ex("stretch", [todo()], { part: "warmup" }), ex("hack", [todo()]), ex("calf", [todo()]), ex("plank", [todo()], { part: "cooldown" })];
    // The same place, either side of the COOL-DOWN line.
    const under = ok(moveExercise(list, { key: "hack", whole: true, at: 2, part: "cooldown" }, context));
    expect(under.ask?.title).toBe("Move Hack Squat to the cool-down?");
    expect(under.exercises.find((exercise) => exercise.key === "hack")?.part).toBe("cooldown");
    expect(ok(moveExercise(list, { key: "hack", whole: true, at: 2, part: null }, context)).ask).toBeNull();
    // In its own place, but dropped under the line below it: it's still a move.
    expect(ok(moveExercise(list, { key: "calf", whole: true, at: 2, part: "cooldown" }, context)).ask?.title).toBe("Move Calf Raise to the cool-down?");
    // A heading that isn't next to where it lands is ignored.
    expect(ok(moveExercise(list, { key: "calf", whole: true, at: 1, part: "cooldown" }, context)).ask).toBeNull();
  });
});

// Why done sets keep their order: what the timeline would show if they moved freely.

describe("what moving done sets would break", () => {
  const rows = (exercises: DraftExercise[]) => timelineRows({ exercises, live: true, started: true, resting: false, isOpen: () => true });

  it("the rests between sets are read from the order: swapped, a 4-minute rest shows as none", () => {
    const inOrder = ex("press", [done(100, 8, 0), done(100, 8, 4), todo()]);
    const swapped = ex("press", [inOrder.sets[1], inOrder.sets[0], todo()]);
    const pause = (exercise: DraftExercise) => rows([exercise]).find((row) => row.type === "pause");
    expect(pause(inOrder)).toMatchObject({ seconds: 240 });
    expect(pause(swapped)).toMatchObject({ seconds: 0 });
  });

  it("a set not done above done ones becomes the set to do, behind the sets already done", () => {
    const press = ex("press", [todo(), done(100, 8, 0), done(100, 8, 4)]);
    expect(nextSet([press])).toEqual({ key: "press", index: 0 });
    expect(rows([press]).filter((row) => row.type === "set").map((row) => row.state)).toEqual(["now", "done", "done"]);
  });
});
