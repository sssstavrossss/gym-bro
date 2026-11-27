import { describe, expect, it } from "vitest";
import {
  demoUrl,
  equipmentLabel,
  exerciseFacts,
  exerciseLine,
  areaFilter,
  inArea,
  inGroup,
  LIST_STEP,
  ofType,
  recentExercises,
  typeLabel,
  moreRows,
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

const skierg = item("skierg", "SkiErg", { category: "cardio", equipment: "machine", primaryMuscles: ["lats", "triceps"], measure: "distance_time" });
const clean = item("clean-and-jerk", "Clean and Jerk", { category: "olympic weightlifting", primaryMuscles: ["shoulders"] });
const boxSquat = item("box-squat", "Box Squat", { category: "powerlifting" });
const kinds = [...all, skierg, clean, boxSquat];

describe("searchExercises", () => {
  it("lists the common lifts first, then by name, when there is no query", () => {
    expect(searchExercises(all, "").map((x) => x.id)).toEqual(["barbell-squat", "run", "dumbbell-bicep-curl", "front-barbell-squat", "hamstring-stretch", "one-arm-dumbbell-row"]);
    expect(searchExercises(all, " ", "all", "arms").map((x) => x.id)).toEqual(["dumbbell-bicep-curl"]);
  });

  it("filters by type and muscle group together", () => {
    expect(searchExercises(kinds, "", "strength").map((x) => x.id)).toEqual(["barbell-squat", "box-squat", "dumbbell-bicep-curl", "front-barbell-squat", "one-arm-dumbbell-row"]);
    expect(searchExercises(kinds, "", "cardio", "back").map((x) => x.id)).toEqual(["skierg"]);
    expect(searchExercises(kinds, "", "hybrid").map((x) => x.id)).toEqual(["run", "skierg"]);
    // A group goes by the main muscles whatever the type: the hamstring stretch is under Legs.
    expect(searchExercises(kinds, "", "stretching", "legs").map((x) => x.id)).toEqual(["hamstring-stretch"]);
  });

  it("finds exercises by their type's words", () => {
    expect(searchExercises(kinds, "hyrox").map((x) => x.id)).toEqual(["run", "skierg"]);
    expect(searchExercises(kinds, "hybrid").map((x) => x.id)).toEqual(["run", "skierg"]);
    expect(searchExercises(kinds, "weight lifting").map((x) => x.id)).toEqual(["clean-and-jerk"]);
    expect(searchExercises(kinds, "olympic").map((x) => x.id)).toEqual(["clean-and-jerk"]);
    expect(searchExercises(kinds, "powerlifting").map((x) => x.id)).toEqual(["box-squat"]);
    expect(searchExercises(kinds, "stretch").map((x) => x.id)).toEqual(["hamstring-stretch"]);
    // A name match still comes before a type match.
    expect(searchExercises(kinds, "squat strength").map((x) => x.id)).toEqual(["barbell-squat", "box-squat", "front-barbell-squat"]);
  });

  it("matches every word at the start of a word, names that start with the query first", () => {
    expect(searchExercises(all, "squat", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
    expect(searchExercises(all, "barb squ", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
    expect(searchExercises(all, "dumb row", "all").map((x) => x.id)).toEqual(["one-arm-dumbbell-row"]);
    expect(searchExercises(all, "quat", "all")).toEqual([]);
  });

  it("finds by equipment or main muscle after name matches", () => {
    expect(searchExercises(all, "biceps", "all").map((x) => x.id)).toEqual(["dumbbell-bicep-curl"]);
    // Run is a common one, so it comes first.
    expect(searchExercises(all, "bodyweight", "all").map((x) => x.id)).toEqual(["run", "hamstring-stretch"]);
    expect(searchExercises(all, "middle", "all").map((x) => x.id)).toEqual(["one-arm-dumbbell-row"]);
  });

  it("ignores case and accents", () => {
    expect(searchExercises(all, "SQUÂT", "all").map((x) => x.id)).toEqual(["barbell-squat", "front-barbell-squat"]);
  });
});

describe("types and groups", () => {
  it("puts each exercise under its type, and Hybrid across the others", () => {
    expect(ofType(boxSquat, "strength")).toBe(true);
    expect(ofType(skierg, "cardio")).toBe(true);
    expect(ofType(skierg, "hybrid")).toBe(true);
    expect(ofType(squat, "hybrid")).toBe(false);
    expect(typeLabel(skierg)).toBe("Hybrid");
    expect(typeLabel(clean)).toBe("Olympic");
    expect(typeLabel(boxSquat)).toBe("Strength");
    expect(typeLabel(stretch)).toBe("Stretching");
  });

  it("groups by main muscle, and maps Explore's areas onto the two rows", () => {
    expect(inGroup(stretch, "legs")).toBe(true);
    expect(inGroup(skierg, "back")).toBe(true);
    expect(inGroup(skierg, "arms")).toBe(true);
    expect(inGroup(skierg, "legs")).toBe(false);
    expect(areaFilter("legs")).toEqual({ type: "all", group: "legs" });
    expect(areaFilter("cardio")).toEqual({ type: "cardio", group: "all" });
    expect(areaFilter("stretching")).toEqual({ type: "stretching", group: "all" });
  });
});

describe("recentExercises", () => {
  it("takes the exercises done lately, newest first and each once", () => {
    const workouts = [{ exercises: ["barbell-squat", "plank"] }, { exercises: ["plank", "run"] }, { exercises: ["skierg"] }];
    expect(recentExercises(workouts)).toEqual(["barbell-squat", "plank", "run", "skierg"]);
    expect(recentExercises(workouts, 2)).toEqual(["barbell-squat", "plank"]);
    expect(recentExercises([])).toEqual([]);
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

describe("moreRows", () => {
  it("grows the drawn rows a step at a time and stops at the end", () => {
    expect(LIST_STEP).toBe(40);
    expect(moreRows(40, 886)).toBe(80);
    expect(moreRows(880, 886)).toBe(886);
    expect(moreRows(886, 886)).toBe(886);
    expect(moreRows(0, 10)).toBe(10);
    expect(moreRows(10, 100, 25)).toBe(35);
  });
});
