import { describe, expect, it } from "vitest";
import { carryOn, fieldParts, hasNode, nextSet, roundOrder, timelineEdges, timelineRows, type TimelineInput } from "../src/lib/timeline";
import { emptySet, type DraftExercise, type DraftSet } from "../src/lib/workout";

const done = (kg: number, reps: number, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps, doneAt: "2026-11-28T18:00:00Z" });
const todo = (kg: number | null = null, reps: number | null = null, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps });
const ex = (key: string, sets: DraftSet[], more: Partial<DraftExercise> = {}): DraftExercise => ({ key, exerciseId: key, sets, ...more });

const input = (exercises: DraftExercise[], more: Partial<TimelineInput> = {}): TimelineInput => ({
  exercises, live: true, started: true, resting: false, isOpen: (_head, current) => current, ...more,
});
const keys = (exercises: DraftExercise[], more: Partial<TimelineInput> = {}) => timelineRows(input(exercises, more)).map((row) => row.key);

describe("the set to do", () => {
  it("goes round a superset one set of each at a time", () => {
    const a = ex("a", [todo(), todo()]);
    const b = ex("b", [todo(), todo(), todo()], { superset: true });
    expect(roundOrder([a, b]).map(({ exercise, index }) => `${exercise.key}${index}`)).toEqual(["a0", "b0", "a1", "b1", "b2"]);
  });

  it("is the first not ticked off, in the order sets are done", () => {
    const squat = ex("squat", [done(100, 5), done(100, 5)]);
    const curl = ex("curl", [done(14, 10), todo()]);
    const push = ex("push", [todo(), todo()], { superset: true });
    expect(nextSet([squat, curl, push])).toEqual({ key: "push", index: 0 });
    expect(nextSet([squat])).toBeNull();
  });
});

describe("the timeline's rows", () => {
  it("open the exercise with the set to do, and fold the others to their heading", () => {
    const squat = ex("squat", [done(100, 5), done(100, 5)]);
    const bench = ex("bench", [done(80, 6), todo(), todo()]);
    const row = ex("row", [todo()]);
    expect(keys([squat, bench, row])).toEqual([
      "start", "ex:squat", "ex:bench", "set:bench:0", "pause:bench:0", "set:bench:1", "pause:bench:1", "set:bench:2", "ex:row", "add",
    ]);
    const rows = timelineRows(input([squat, bench, row]));
    const state = (key: string) => rows.find((each) => each.key === key)?.state;
    expect([state("ex:squat"), state("ex:bench"), state("ex:row")]).toEqual(["done", "now", "next"]);
    expect([state("set:bench:0"), state("set:bench:1"), state("set:bench:2")]).toEqual(["done", "now", "next"]);
  });

  it("show a past workout open, with no set to do", () => {
    const rows = timelineRows(input([ex("a", [done(60, 5), todo()])], { live: false, isOpen: () => true }));
    expect(rows.map((row) => row.key)).toEqual(["start", "ex:a", "set:a:0", "set:a:1", "add"]);
    expect(rows.some((row) => row.state === "now")).toBe(false);
  });

  it("put a superset of two on two lanes, its sets in rounds, merging after", () => {
    const a = ex("a", [done(14, 10), todo()]);
    const b = ex("b", [done(30, 12), todo()], { superset: true });
    const rows = timelineRows(input([a, b]));
    expect(rows.map((row) => row.key)).toEqual([
      "start", "run:a", "ex:a", "ex:b", "set:a:0", "set:b:0", "pause:b:0", "set:a:1", "set:b:1", "merge:a", "add",
    ]);
    const lane = (key: string) => rows.find((row) => row.key === key)?.lane;
    expect([lane("ex:a"), lane("ex:b"), lane("set:a:1"), lane("set:b:1"), lane("pause:b:0"), lane("merge:a")]).toEqual([0, 1, 0, 1, 0, 0]);
    const letters = rows.flatMap((row) => (row.type === "exercise" ? [row.letter] : []));
    expect(letters).toEqual(["A", "B"]);
  });

  it("keep a circuit of three on one lane, lettered", () => {
    const run = [ex("a", [todo()]), ex("b", [todo()], { superset: true }), ex("c", [todo()], { superset: true })];
    const rows = timelineRows(input(run));
    expect(rows.every((row) => row.lane === 0)).toBe(true);
    expect(rows.flatMap((row) => (row.type === "exercise" ? [row.letter] : []))).toEqual(["A", "B", "C"]);
    expect(rows.find((row) => row.type === "run")).toMatchObject({ size: 3, state: "now" });
  });

  it("give one exercise on a clock its heading, and no merge", () => {
    const keysNow = keys([ex("a", [todo()], { timed: { format: "amrap", minutes: 10 } as never })]);
    expect(keysNow).toContain("run:a");
    expect(keysNow.some((key) => key.startsWith("merge:"))).toBe(false);
  });

  it("put the rest running just before the set it leads to", () => {
    const bench = ex("bench", [done(80, 6), todo()]);
    expect(keys([bench], { resting: true })).toEqual(["start", "ex:bench", "set:bench:0", "rest", "set:bench:1", "add"]);
  });

  it("put a rest between sets: how long it was, once both are ticked, else the one planned", () => {
    const at = (time: string): DraftSet => ({ ...done(80, 6), doneAt: `2026-11-28T${time}Z` });
    const bench = ex("bench", [at("18:16:00"), at("18:18:04"), todo(), todo()]);
    const rows = timelineRows(input([bench]));
    const pause = (key: string) => rows.find((row) => row.key === key);
    expect(pause("pause:bench:0")).toMatchObject({ type: "pause", state: "done", seconds: 124 });
    // Ticked, and the next set came without a rest running: over, with no length to show.
    expect(pause("pause:bench:1")).toMatchObject({ state: "done", seconds: null });
    expect(pause("pause:bench:2")).toMatchObject({ state: "next", seconds: null });
  });

  it("put no rests in a past workout or on a clock", () => {
    expect(keys([ex("a", [done(60, 5), done(60, 5)])], { live: false, isOpen: () => true }).some((key) => key.startsWith("pause:"))).toBe(false);
    const timed = ex("a", [todo(), todo()], { timed: { format: "emom", minutes: 10 } as never });
    expect(keys([timed]).some((key) => key.startsWith("pause:"))).toBe(false);
  });

  it("put the rest at the end when its set is folded away, or there is none", () => {
    const squat = ex("squat", [done(100, 5)]);
    const bench = ex("bench", [todo()]);
    expect(keys([squat, bench], { resting: true, isOpen: () => false })).toEqual(["start", "ex:squat", "ex:bench", "rest", "add"]);
    expect(keys([squat], { resting: true }).slice(-2)).toEqual(["rest", "add"]);
  });

  it("head each part, with no node", () => {
    const rows = timelineRows(input([ex("w", [todo()], { part: "warmup" }), ex("a", [todo()]), ex("c", [todo()], { part: "cooldown" })]));
    const parts = rows.filter((row) => row.type === "part");
    expect(parts.map((row) => row.type === "part" && row.label)).toEqual(["Warm-up", "Workout", "Cool-down"]);
    expect(parts.some(hasNode)).toBe(false);
  });

  it("say the start is still to come before the workout starts", () => {
    expect(timelineRows(input([], { started: false }))[0]).toMatchObject({ key: "start", state: "next" });
    expect(keys([])).toEqual(["start", "add"]);
  });
});

describe("the rail", () => {
  it("joins each node to the one before, solid up to the set to do and dotted ahead", () => {
    const bench = ex("bench", [done(80, 6), todo(), todo()]);
    const edges = timelineEdges(timelineRows(input([bench])));
    expect(edges.map((edge) => `${edge.from}>${edge.to}:${edge.kind}`)).toEqual([
      "start>ex:bench:done", "ex:bench>set:bench:0:done", "set:bench:0>pause:bench:0:done", "pause:bench:0>set:bench:1:done",
      "set:bench:1>pause:bench:1:next", "pause:bench:1>set:bench:2:next", "set:bench:2>add:next",
    ]);
  });

  it("runs the rest's stretch into the set it leads to", () => {
    const bench = ex("bench", [done(80, 6), todo()]);
    const edges = timelineEdges(timelineRows(input([bench], { resting: true })));
    expect(edges.find((edge) => edge.from === "rest")).toMatchObject({ to: "set:bench:1", kind: "rest" });
    expect(edges.find((edge) => edge.to === "rest")).toMatchObject({ from: "set:bench:0", kind: "done" });
  });

  it("branches the second lane off the superset's heading and merges both back", () => {
    const a = ex("a", [todo()]);
    const b = ex("b", [todo()], { superset: true });
    const edges = timelineEdges(timelineRows(input([a, b, ex("c", [todo()])])));
    const pairs = edges.map((edge) => `${edge.from}>${edge.to}`);
    expect(pairs).toContain("run:a>ex:b");
    expect(pairs).toContain("ex:b>set:b:0");
    expect(pairs).toContain("set:a:0>merge:a");
    expect(pairs).toContain("set:b:0>merge:a");
    expect(pairs).toContain("merge:a>ex:c");
    expect(edges.find((edge) => edge.to === "ex:b")).toMatchObject({ fromLane: 0, toLane: 1 });
  });
});

describe("a set's numbers", () => {
  it("split into number and unit", () => {
    expect(fieldParts("kg", 62.5)).toEqual({ n: "62.5", unit: "kg" });
    expect(fieldParts("reps", 8)).toEqual({ n: "8", unit: "reps" });
    expect(fieldParts("seconds", 90)).toEqual({ n: "1:30", unit: "" });
    expect(fieldParts("seconds", 3725)).toEqual({ n: "1:02:05", unit: "" });
    expect(fieldParts("metres", 400)).toEqual({ n: "400", unit: "m" });
    expect(fieldParts("metres", 5250)).toEqual({ n: "5.25", unit: "km" });
    expect(fieldParts("kg", null)).toEqual({ n: "—", unit: "kg" });
  });

  it("carry a picked number on to the later sets still showing the old one", () => {
    const sets = [done(60, 5), todo(60, 5), todo(60, 5), todo(65, 5)];
    expect(carryOn(sets, 1, "kg", 60)).toEqual([2]);
    expect(carryOn([todo(), todo(), todo()], 0, "kg", null)).toEqual([1, 2]);
    expect(carryOn([todo(60), done(60, 5), todo(60)], 0, "kg", 60)).toEqual([2]);
  });

  it("keep a warm-up's numbers off the working sets", () => {
    const sets = [todo(20, 10, "warmup"), todo(40, 5, "warmup"), todo(), todo()];
    expect(carryOn(sets, 0, "kg", 20)).toEqual([]);
    expect(carryOn(sets, 2, "kg", null)).toEqual([3]);
  });
});
