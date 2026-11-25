import { describe, expect, it } from "vitest";
import {
  clockOver,
  clockView,
  fitSets,
  fromBlockBody,
  newTimed,
  nextRoundSet,
  plannedRounds,
  roundsDone,
  runHeading,
  scoreLine,
  stopped,
  toBlockBody,
  type TimedState,
} from "../src/lib/timed";
import { dropUndone, emptySet, finished, fromSaved, toRequest, withoutExercise, type DraftExercise, type DraftSet, type DraftWorkout } from "../src/lib/workout";

const start = Date.parse("2026-11-25T17:00:00.000Z");
const at = (seconds: number) => start + seconds * 1000;
const done = (reps = 5): DraftSet => ({ ...emptySet(), reps, doneAt: "2026-11-25T17:01:00.000Z" });

function exercise(key: string, sets: DraftSet[], extra: Partial<DraftExercise> = {}): DraftExercise {
  return { key, exerciseId: `ex-${key}`, sets, ...extra };
}

function running(format: TimedState["format"], extra: Partial<TimedState> = {}): TimedState {
  return { ...newTimed(format), startedAt: new Date(start).toISOString(), ...extra };
}

function workout(exercises: DraftExercise[]): DraftWorkout {
  return { id: "w1", date: "2026-11-25", startedAt: "2026-11-25T16:50:00.000Z", endedAt: null, name: null, exercises, restEndsAt: null, restFor: 0 };
}

describe("timed blocks", () => {
  it("start with sensible defaults and keep the minutes between EMOM and AMRAP", () => {
    expect(newTimed("emom")).toMatchObject({ format: "emom", minutes: 10, every: 1, startedAt: null });
    expect(newTimed("amrap").minutes).toBe(12);
    expect(newTimed("amrap", { ...newTimed("emom"), minutes: 16 }).minutes).toBe(16);
    expect(newTimed("for_time").minutes).toBe(0);
  });

  it("counts rounds as the sets of the run", () => {
    const run = [exercise("a", [done(), done(), emptySet()]), exercise("b", [done(), emptySet(), emptySet()], { superset: true })];
    expect(roundsDone(run)).toBe(1);
    expect(plannedRounds({ ...newTimed("emom"), minutes: 12, every: 2 }, run)).toBe(6);
    expect(plannedRounds(newTimed("for_time"), run)).toBe(3);
    expect(plannedRounds(newTimed("amrap"), run)).toBeNull();
  });

  it("fits an exercise to a number of rounds, keeping ticked sets and warm-ups", () => {
    const warm: DraftSet = { ...emptySet("warmup") };
    const fitted = fitSets(exercise("a", [warm, done(), emptySet(), emptySet()]), 6);
    expect(fitted.sets.filter((set) => set.type === "working")).toHaveLength(6);
    expect(fitted.sets[0].type).toBe("warmup");
    const fewer = fitSets(exercise("a", [warm, done(), done(), emptySet(), emptySet()]), 1);
    // Two are ticked already, so both stay.
    expect(fewer.sets.map((set) => [set.type, !!set.doneAt])).toEqual([["warmup", false], ["working", true], ["working", true]]);
  });

  it("finds the next round's set, and an AMRAP runs on past its sets", () => {
    const a = exercise("a", [{ ...done(8), kg: 20 }]);
    expect(nextRoundSet(a, "for_time")).toBeNull();
    const more = nextRoundSet(a, "amrap")!;
    expect(more.index).toBe(1);
    expect(more.exercise.sets[1]).toMatchObject({ kg: 20, reps: 8, doneAt: null });
    expect(nextRoundSet(exercise("b", [done(), emptySet()]), "emom")).toMatchObject({ index: 1 });
  });

  it("shows the clock for each format", () => {
    const run = [exercise("a", [done(), emptySet(), emptySet()])];
    expect(clockView(newTimed("amrap"), run, at(0))).toMatchObject({ phase: "ready", time: "12:00", caption: "As many rounds as you can in 12 min" });
    expect(clockView(newTimed("emom"), run, at(0)).caption).toBe("10 rounds, one each minute");
    expect(clockView({ ...newTimed("emom"), every: 2 }, run, at(0)).caption).toBe("5 rounds, one every 2 minutes");
    expect(clockView(newTimed("for_time"), run, at(0)).caption).toBe("3 rounds as fast as you can");

    expect(clockView(running("emom"), run, at(130))).toMatchObject({ phase: "running", time: "0:50", caption: "Round 3 of 10", round: 3 });
    expect(clockView(running("amrap"), run, at(65))).toMatchObject({ phase: "running", time: "10:55", caption: "1 round so far" });
    expect(clockView(running("for_time"), run, at(95))).toMatchObject({ phase: "running", time: "1:35", caption: "Round 2 of 3" });

    expect(clockOver(running("amrap"), at(12 * 60))).toBe(true);
    expect(clockOver(running("for_time"), at(99 * 60))).toBe(false);
    expect(clockView(running("amrap"), run, at(13 * 60)).phase).toBe("over");
  });

  it("stops: for time keeps how long it took, the others end at their time at the latest", () => {
    expect(stopped(running("for_time"), new Date(at(512)))).toMatchObject({ seconds: 512, endedAt: new Date(at(512)).toISOString() });
    expect(stopped(running("amrap"), new Date(at(20 * 60))).endedAt).toBe(new Date(at(12 * 60)).toISOString());
    const never = newTimed("emom");
    expect(stopped(never, new Date(at(10)))).toBe(never);
  });

  it("says what a run is and how it scored", () => {
    const run = [exercise("a", [done(), done()]), exercise("b", [done(), done()], { superset: true })];
    expect(runHeading(null, run)).toBe("Superset · rest after each round");
    expect(runHeading({ ...newTimed("emom"), every: 2 }, run)).toBe("EMOM 10 min · a round every 2 minutes");
    expect(runHeading(newTimed("amrap"), run)).toBe("AMRAP 12 min · as many rounds as you can");
    expect(runHeading(newTimed("for_time"), run)).toBe("For time · 2 rounds");
    expect(scoreLine({ ...newTimed("amrap"), reps: 3 }, run)).toBe("AMRAP 12 min · 2 rounds + 3 reps");
    expect(scoreLine({ ...newTimed("amrap"), reps: 1 }, run.slice(0, 1).map((each) => ({ ...each, sets: [done()] })))).toBe("AMRAP 12 min · 1 round + 1 rep");
    expect(scoreLine(newTimed("emom"), run)).toBe("EMOM 10 min · 2 of 10 rounds");
    expect(scoreLine({ ...newTimed("for_time"), seconds: 512 }, run)).toBe("For time · 8:32");
    expect(scoreLine(newTimed("for_time"), run)).toBe("For time · 2 of 2 rounds");
  });

  it("saves the score with the block and reads it back on the run's first exercise", () => {
    const timed = { ...newTimed("amrap"), reps: 4 };
    const list = [
      exercise("s", [done()]),
      exercise("a", [done(), done()], { timed }),
      exercise("b", [done(), done()], { superset: true }),
    ];
    const body = toRequest(workout(list), "UTC");
    expect(body.blocks).toEqual([{ block: 1, format: "amrap", minutes: 12, every: null, rounds: 2, reps: 4, seconds: null }]);
    expect(toBlockBody({ ...newTimed("for_time"), seconds: 300 }, list.slice(1), 2)).toMatchObject({ format: "for_time", minutes: null, seconds: 300 });
    const back = fromSaved({ id: "w1", date: "2026-11-25", name: null, startedAt: null, endedAt: null, sets: body.sets, blocks: body.blocks });
    expect(back.exercises.map((each) => each.timed?.format ?? null)).toEqual([null, "amrap", null]);
    expect(back.exercises[1].timed).toEqual(fromBlockBody(body.blocks[0]));
  });

  it("keeps a run and its clock together when its first exercise goes", () => {
    const timed = newTimed("emom");
    const list = [exercise("a", [emptySet()], { timed }), exercise("b", [done()], { superset: true }), exercise("c", [done()], { superset: true })];
    const kept = dropUndone(workout(list)).exercises;
    expect(kept.map((each) => [each.key, !!each.superset, each.timed?.format ?? null])).toEqual([["b", false, "emom"], ["c", true, null]]);
    const removed = withoutExercise(list, 0).exercises;
    expect(removed[0]).toMatchObject({ key: "b", superset: false, timed });
  });

  it("stops a clock still running when the workout finishes", () => {
    const list = [exercise("a", [done()], { timed: running("for_time") })];
    const saved = finished(workout(list), new Date(at(200)));
    expect(saved.exercises[0].timed).toMatchObject({ seconds: 200 });
  });
});
