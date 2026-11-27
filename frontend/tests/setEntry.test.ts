import { describe, expect, it } from "vitest";
import { nextSetIndex, sameAs, screenStatus, setLabels, setName, stepped, usesSetScreen } from "../src/lib/setEntry";
import { emptySet, type DraftExercise, type DraftSet } from "../src/lib/workout";

const done = (kg: number, reps: number, type: DraftSet["type"] = "working"): DraftSet => ({ ...emptySet(type), kg, reps, doneAt: "2026-11-27T18:00:00Z" });
const exercise = (key: string, more: Partial<DraftExercise> = {}): DraftExercise => ({ key, exerciseId: key, sets: [emptySet()], ...more });

describe("the exercise screen", () => {
  it("is for a quick workout's exercises on their own", () => {
    const quick = { plan: null, exercises: [exercise("a"), exercise("b"), exercise("c", { superset: true }), exercise("d", { timed: { format: "amrap", minutes: 10 } as never })] };
    expect(usesSetScreen(quick, "a")).toBe(true);
    expect(usesSetScreen(quick, "b")).toBe(false);
    expect(usesSetScreen(quick, "c")).toBe(false);
    expect(usesSetScreen(quick, "d")).toBe(false);
    expect(usesSetScreen({ ...quick, plan: { planId: "p" } as never }, "a")).toBe(false);
    expect(usesSetScreen(null, "a")).toBe(false);
  });

  it("names sets, and the one a log would add", () => {
    const sets = [done(20, 10, "warmup"), done(40, 5, "warmup"), done(60, 5), emptySet(), emptySet("drop")];
    expect(setLabels(sets)).toEqual(["W", "W", "1", "2", "D"]);
    expect(setName(sets, 1)).toBe("Warm-up set 2");
    expect(setName(sets, 3)).toBe("Set 2");
    expect(setName(sets, 4)).toBe("Drop set");
    expect(setName(sets, 5)).toBe("Set 3");
  });

  it("goes to the first set not done, else one more", () => {
    expect(nextSetIndex([done(60, 5), emptySet(), emptySet()])).toBe(1);
    expect(nextSetIndex([done(60, 5), done(60, 5)])).toBe(2);
    expect(nextSetIndex([])).toBe(0);
  });

  it("says which set is up in the header", () => {
    expect(screenStatus([done(60, 5), emptySet(), emptySet()], 1)).toBe("Set 2 of 3");
    expect(screenStatus([done(60, 5), emptySet()], 0)).toBe("Editing set 1");
    expect(screenStatus([done(20, 10, "warmup"), emptySet()], 0)).toBe("Editing warm-up set");
    expect(screenStatus([emptySet("warmup"), emptySet()], 0)).toBe("Warm-up set");
    expect(screenStatus([done(60, 5), done(60, 5)], 2)).toBe("2 of 2 done · one more?");
  });

  it("offers the set before, else the same set last time", () => {
    const today = exercise("a", { sets: [done(60, 5), emptySet()] });
    expect(sameAs(today, 1, [], "weight_reps")).toEqual({ label: "Same as before · 60 × 5", values: { kg: 60, reps: 5, rir: null, seconds: null, metres: null } });
    const saved = (kg: number, reps: number) => ({ ...emptySet(), kg, reps, exerciseId: "b", block: 0, calories: null });
    const last = [saved(55, 8), saved(57.5, 6)];
    expect(sameAs(exercise("b", { sets: [emptySet()] }), 0, last, "weight_reps")?.label).toBe("Same as last time · 55 × 8");
    // A warm-up isn't filled from a working set, nor from last time.
    expect(sameAs(exercise("c", { sets: [done(60, 5), emptySet("warmup")] }), 1, last, "weight_reps")).toBeNull();
    expect(sameAs(exercise("d", { sets: [emptySet()] }), 0, [], "weight_reps")).toBeNull();
  });

  it("steps a field from what it shows, never below 0", () => {
    expect(stepped("kg", 60, 2.5)).toBe(62.5);
    expect(stepped("kg", null, 2.5)).toBe(2.5);
    expect(stepped("kg", 1, -2.5)).toBe(0);
  });
});
