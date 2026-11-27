import { describe, expect, it } from "vitest";
import { workoutChangeLines, workoutChanges, type PlanWorkout } from "../src/lib/plan";
import { planBehindLine, trainingChanges, type TrainingSettings } from "../src/lib/training";

const base: TrainingSettings = { minutes: 40, experience: "some", equipment: ["gym"], goEasy: [], warmUp: false, coolDown: false };

describe("trainingChanges", () => {
  it("lists time, experience, equipment and go easy on, but not the warm-up or cool-down", () => {
    expect(trainingChanges(base, { ...base, warmUp: true, coolDown: true })).toEqual([]);
    expect(trainingChanges(base, { ...base, minutes: 45, experience: "experienced", equipment: ["dumbbells", "gym"], goEasy: ["knees"] })).toEqual([
      { label: "Time", now: "40 min", next: "45 min" },
      { label: "Experience", now: "Some", next: "Experienced" },
      { label: "Equipment", now: "Full gym", next: "Full gym, Dumbbells" },
      { label: "Go easy on", now: "Nothing", next: "Knees" },
    ]);
  });
});

describe("planBehindLine", () => {
  it("says what the plan was made with", () => {
    expect(planBehindLine(trainingChanges(base, { ...base, minutes: 45 }))).toBe("Your plan was made with 40 min.");
    expect(planBehindLine(trainingChanges(base, { ...base, minutes: 45, experience: "new", goEasy: ["knees"] })))
      .toBe("Your plan was made with 40 min, Some experience and nothing to go easy on.");
    expect(planBehindLine(trainingChanges({ ...base, goEasy: ["knees", "shoulders"] }, base))).toBe("Your plan was made with Shoulders, Knees to go easy on.");
  });
});

describe("workoutChanges", () => {
  const exercise = (exerciseId: string, sets = 3) => ({ exerciseId, sets, repMin: 6, repMax: 10, seconds: null, restSeconds: 120 });
  const workout = (name: string, minutes: number, ids: string[], edited = false): PlanWorkout =>
    ({ id: name, name, minutes, exercises: ids.map((id) => exercise(id)), edited });

  it("pairs workouts by name and says what each gains, loses and takes", () => {
    const changes = workoutChanges(
      [workout("Upper A", 40, ["bench", "row", "curl"], true), workout("Lower A", 40, ["squat", "rdl"])],
      [workout("Lower A", 40, ["squat", "rdl"]), workout("Upper A", 45, ["bench", "row", "raise", "pushdown"])],
    );
    expect(changes[0]).toEqual({ name: "Lower A", minutesNow: 40, minutesNew: 40, setsNow: 6, setsNew: 6, added: [], removed: [], edited: false });
    expect(changes[1]).toMatchObject({ name: "Upper A", minutesNow: 40, minutesNew: 45, setsNow: 9, setsNew: 12, added: ["raise", "pushdown"], removed: ["curl"], edited: true });
    const name = (id: string) => id[0].toUpperCase() + id.slice(1);
    expect(workoutChangeLines(changes[1], name)).toEqual(["~40 → ~45 min · 9 → 12 sets", "+ Raise · + Pushdown · − Curl"]);
    expect(workoutChangeLines(changes[0], name)).toEqual(["No change"]);
  });
});
