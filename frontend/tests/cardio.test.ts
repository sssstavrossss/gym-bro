import { describe, expect, it } from "vitest";
import { cardioSet, distanceText, paceLine, paceText, paceUnit } from "../src/lib/cardio";
import { emptySet, exerciseSummary, historyLine, toRequest, workoutTotals, type DraftExercise, type DraftWorkout } from "../src/lib/workout";

const set = (metres: number | null, seconds: number | null, done = true, kg: number | null = null) => ({ ...emptySet(), metres, seconds, kg, doneAt: done ? "2026-11-25T10:00:00Z" : null });

describe("cardio", () => {
  it("says a distance in metres up to a kilometre, then in km", () => {
    expect(distanceText(800)).toBe("800 m");
    expect(distanceText(999.5)).toBe("999.5 m");
    expect(distanceText(5000)).toBe("5 km");
    expect(distanceText(21097.5)).toBe("21.1 km");
    expect(distanceText(10250)).toBe("10.25 km");
  });

  it("gives each sport its own pace", () => {
    expect(paceUnit("run")).toBe("km");
    expect(paceUnit("rowing-stationary")).toBe("500m");
    expect(paceUnit("swim")).toBe("100m");
    expect(paceUnit("bicycling")).toBe("kmh");
    expect(paceUnit("stairmaster")).toBeNull();
    expect(paceText(5000, 1500, "km")).toBe("5:00 /km");
    expect(paceText(2000, 450, "500m")).toBe("1:53 /500 m");
    expect(paceText(1500, 1875, "100m")).toBe("2:05 /100 m");
    expect(paceText(20000, 3000, "kmh")).toBe("24.0 km/h");
    expect(paceText(5000, null, "km")).toBe("");
    expect(paceText(5000, 1500, null)).toBe("");
  });

  it("puts a set in words with its pace", () => {
    expect(cardioSet(set(5000, 1500), "km")).toBe("5 km · 25:00 · 5:00 /km");
    expect(cardioSet(set(5000, null), "km")).toBe("5 km");
    expect(cardioSet(set(400, 95), null)).toBe("400 m · 1:35");
    expect(cardioSet(set(null, null), "km")).toBe("—");
    const run: DraftExercise = { key: "e1", exerciseId: "run", sets: [set(5000, 1500), set(1000, 240, false)] };
    expect(exerciseSummary(run.sets, "distance_time", "run")).toBe("5 km · 25:00 · 5:00 /km");
  });

  it("shows the pace of the set being typed, else the last with both", () => {
    const run: DraftExercise = { key: "e1", exerciseId: "run", sets: [set(5000, 1500), set(1000, null, false)] };
    expect(paceLine(run, null)).toBe("Pace 5:00 /km");
    expect(paceLine(run, 1)).toBe("");
    expect(paceLine({ ...run, exerciseId: "bicycling" }, 0)).toBe("Speed 12.0 km/h");
    expect(paceLine({ ...run, exerciseId: "stairmaster" }, null)).toBe("");
  });

  it("adds up the distance, leaving out sets not done and sets with a weight", () => {
    const workout: DraftWorkout = {
      id: "w", date: "2026-11-25", startedAt: null, endedAt: null, name: null, restEndsAt: null, restFor: 0,
      exercises: [
        { key: "e1", exerciseId: "run", sets: [set(5000, 1500), set(1000, 240, false)] },
        { key: "e2", exerciseId: "sled-pull", sets: [set(50, null, true, 100)] },
      ],
    };
    expect(workoutTotals(workout).metres).toBe(5000);
    // The server takes the kind from the exercises.
    expect(toRequest(workout, "UTC").kind).toBeNull();
    expect(historyLine({ exercises: ["run"], sets: 1, volumeKg: 0, metres: 5000 }, () => "Run")).toBe("Run · 1 set · 5 km");
  });
});
