import { describe, expect, it } from "vitest";
import {
  demoUrl,
  equipmentLabel,
  exerciseFacts,
  exerciseLine,
  inArea,
  muscleLabel,
  photoUrl,
  searchExercises,
  type ExerciseItem,
} from "../src/lib/exercises";

function item(id: string, name: string, extra: Partial<ExerciseItem> = {}): ExerciseItem {
  return {
    id, name, category: "strength", equipment: "barbell", level: "beginner", mechanic: "compound", force: "push",
    measure: "weight_reps", primaryMuscles: ["quadriceps"], secondaryMuscles: [], images: 2, ...extra,
  };
}

const squat = item("barbell-squat", "Barbell Squat");
const frontSquat = item("front-barbell-squat", "Front Barbell Squat");
const row = item("one-arm-dumbbell-row", "One-Arm Dumbbell Row", { equipment: "dumbbell", primaryMuscles: ["middle-back"] });
const curl = item("dumbbell-bicep-curl", "Dumbbell Bicep Curl", { equipment: "dumbbell", primaryMuscles: ["biceps"] });
const stretch = item("hamstring-stretch", "Hamstring Stretch", { category: "stretching", equipment: "bodyweight", primaryMuscles: ["hamstrings"] });
const run = item("run", "Run", { category: "cardio", equipment: "bodyweight", primaryMuscles: ["quadriceps"], images: 0 });
const all = [squat, frontSquat, row, curl, stretch, run];

describe("searchExercises", () => {
  it("lists an area by name when there is no query", () => {
    expect(searchExercises(all, "", "all").map((x) => x.id)).toEqual(["barbell-squat", "dumbbell-bicep-curl", "front-barbell-squat", "hamstring-stretch", "one-arm-dumbbell-row", "run"]);
    expect(searchExercises(all, " ", "arms").map((x) => x.id)).toEqual(["dumbbell-bicep-curl"]);
  });

  it("matches every word at the start of a word, names that start with the query first", () => {
    expect(searchExercises(all, "squat", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
    expect(searchExercises(all, "barb squ", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
    expect(searchExercises(all, "dumb row", "all").map((x) => x.id)).toEqual(["one-arm-dumbbell-row"]);
    expect(searchExercises(all, "quat", "all")).toEqual([]);
  });

  it("finds by equipment or main muscle after name matches", () => {
    expect(searchExercises(all, "biceps", "all").map((x) => x.id)).toEqual(["dumbbell-bicep-curl"]);
    expect(searchExercises(all, "bodyweight", "all").map((x) => x.id)).toEqual(["hamstring-stretch", "run"]);
    expect(searchExercises(all, "middle", "all").map((x) => x.id)).toEqual(["one-arm-dumbbell-row"]);
  });

  it("ignores case and accents", () => {
    expect(searchExercises(all, "SQUÂT", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
  });
});

describe("inArea", () => {
  it("puts stretches and cardio only under their own chip", () => {
    expect(inArea(stretch, "legs")).toBe(false);
    expect(inArea(stretch, "stretching")).toBe(true);
    expect(inArea(run, "legs")).toBe(false);
    expect(inArea(run, "cardio")).toBe(true);
    expect(inArea(squat, "legs")).toBe(true);
    expect(inArea(row, "back")).toBe(true);
    expect(inArea(row, "legs")).toBe(false);
  });
});

describe("labels", () => {
  it("reads the API's ids as words", () => {
    expect(equipmentLabel("medicine-ball")).toBe("Medicine ball");
    expect(equipmentLabel("ez-bar")).toBe("EZ bar");
    expect(equipmentLabel("none")).toBe("No equipment");
    expect(muscleLabel("middle-back")).toBe("Middle back");
    expect(exerciseLine(row)).toBe("Dumbbell · Middle back");
    expect(exerciseLine(item("x", "X", { primaryMuscles: ["glutes", "hamstrings"] }))).toBe("Barbell · Glutes, Hamstrings");
    expect(exerciseFacts(squat)).toBe("Barbell · compound · beginner");
    expect(exerciseFacts(item("x", "X", { mechanic: null }))).toBe("Barbell · beginner");
  });

  it("builds photo and demo addresses", () => {
    expect(photoUrl("/exercise-photos/f00c92c", "barbell-squat", 1)).toBe("/exercise-photos/f00c92c/barbell-squat/1.webp");
    expect(demoUrl("Barbell Squat")).toBe("https://www.youtube.com/results?search_query=Barbell%20Squat%20exercise%20form");
  });
});
