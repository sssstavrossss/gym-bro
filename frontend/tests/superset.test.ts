import { describe, expect, it } from "vitest";
import {
  emptySet,
  exerciseGroups,
  fromSaved,
  groupName,
  groupOf,
  roundDone,
  swapExercise,
  toggleSuperset,
  toRequest,
  withoutExercise,
  type DraftExercise,
  type DraftWorkout,
} from "../src/lib/workout";

const done = (): ReturnType<typeof emptySet> => ({ ...emptySet(), kg: 50, reps: 10, doneAt: "2026-11-25T17:05:00.000Z" });

function exercise(key: string, superset = false, sets = [emptySet(), emptySet()]): DraftExercise {
  return { key, exerciseId: `ex-${key}`, sets, ...(superset ? { superset } : {}) };
}

function workout(exercises: DraftExercise[]): DraftWorkout {
  return { id: "w1", date: "2026-11-25", startedAt: "2026-11-25T17:00:00.000Z", endedAt: null, name: null, exercises, restEndsAt: null, restFor: 0 };
}

const keys = (runs: DraftExercise[][]) => runs.map((run) => run.map((each) => each.key));

describe("supersets", () => {
  it("groups each exercise joined to the one before into its run", () => {
    const list = [exercise("a"), exercise("b", true), exercise("c"), exercise("d", true), exercise("e", true)];
    expect(keys(exerciseGroups(list))).toEqual([["a", "b"], ["c", "d", "e"]]);
    expect(groupOf(list, "d").map((each) => each.key)).toEqual(["c", "d", "e"]);
    expect(groupOf(list, "x")).toEqual([]);
    // A first exercise marked joined (an old draft, say) still starts its own run.
    expect(keys(exerciseGroups([exercise("a", true), exercise("b")]))).toEqual([["a"], ["b"]]);
  });

  it("names two a superset and three or more a circuit", () => {
    expect(groupName(2)).toBe("Superset");
    expect(groupName(3)).toBe("Circuit");
  });

  it("ends a round once every exercise in the run has that set ticked", () => {
    const list = [exercise("a", false, [done(), emptySet()]), exercise("b", true, [emptySet(), emptySet(), emptySet()])];
    expect(roundDone(list, "a", 0)).toBe(false);
    list[1].sets[0] = done();
    expect(roundDone(list, "b", 0)).toBe(true);
    // b's third set has no partner in a, so it ends its round alone.
    list[1].sets[2] = done();
    expect(roundDone(list, "b", 2)).toBe(true);
    // Straight sets end a round with each set.
    expect(roundDone([exercise("c", false, [done()])], "c", 0)).toBe(true);
  });

  it("joins an exercise to the one before, splits it off again, and leaves the first alone", () => {
    const list = [exercise("a"), exercise("b"), exercise("c")];
    const joined = toggleSuperset(list, "b");
    expect(keys(exerciseGroups(joined))).toEqual([["a", "b"], ["c"]]);
    expect(keys(exerciseGroups(toggleSuperset(joined, "c")))).toEqual([["a", "b", "c"]]);
    expect(keys(exerciseGroups(toggleSuperset(joined, "b")))).toEqual([["a"], ["b"], ["c"]]);
    expect(toggleSuperset(list, "a")).toEqual(list);
  });

  it("keeps the rest of a superset together when its first exercise goes", () => {
    const list = [exercise("z"), exercise("a"), exercise("b", true), exercise("c", true)];
    const { exercises, led } = withoutExercise(list, 1);
    expect(led).toBe(true);
    expect(keys(exerciseGroups(exercises))).toEqual([["z"], ["b", "c"]]);
    const middle = withoutExercise(list, 2);
    expect(middle.led).toBe(false);
    expect(keys(exerciseGroups(middle.exercises))).toEqual([["z"], ["a", "c"]]);
  });

  it("shares one block for a superset when saved, and reads it back", () => {
    const list = [
      exercise("a", false, [done()]),
      exercise("b", true, [done()]),
      exercise("c", false, [done(), done()]),
    ];
    const body = toRequest(workout(list), "Europe/Oslo");
    expect(body.sets.map((set) => [set.exerciseId, set.block])).toEqual([["ex-a", 0], ["ex-b", 0], ["ex-c", 1], ["ex-c", 1]]);
    const back = fromSaved({ id: "w1", date: "2026-11-25", name: null, startedAt: null, endedAt: null, sets: body.sets.map((set) => ({ ...set })) });
    expect(back.exercises.map((each) => [each.exerciseId, !!each.superset, each.sets.length])).toEqual([["ex-a", false, 1], ["ex-b", true, 1], ["ex-c", false, 2]]);
  });

  it("keeps a swapped exercise in its superset", () => {
    const b = exercise("b", true, [done(), emptySet()]);
    const { keep, next } = swapExercise(b, "ex-x", "e9");
    expect(keep?.superset).toBe(true);
    expect(next.superset).toBe(true);
    // The first of a superset swapped part-way: the new one leads the run, the done sets stand alone.
    const a = exercise("a", false, [done(), emptySet()]);
    const swapped = swapExercise(a, "ex-x", "e9");
    expect(keys(exerciseGroups([swapped.keep!, swapped.next, b]))).toEqual([["a"], ["e9", "b"]]);
  });
});
