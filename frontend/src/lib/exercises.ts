// The exercise library on the Train tab: body areas, search, and the words shown for the API's ids.

/** What a set of the exercise records (README → Exercise library → Measure). */
export type ExerciseMeasure = "weight_reps" | "reps" | "time" | "distance_time" | "weight_distance";

/** One exercise as `GET /api/exercises` lists it. */
export interface ExerciseItem {
  id: string;
  name: string;
  category: string;
  equipment: string;
  level: string;
  mechanic: string | null;
  force: string | null;
  measure: ExerciseMeasure;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** How many photos it has, numbered from 0. */
  images: number;
}

export type ExerciseArea = "all" | "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "cardio" | "stretching";

/**
 * The filter chips. A strength area matches the exercise's main muscles; Cardio and Stretching match its category,
 * so a hamstring stretch is under Stretching and not under Legs.
 */
export const EXERCISE_AREAS: { id: ExerciseArea; label: string; muscles?: string[]; category?: string }[] = [
  { id: "all", label: "All" },
  { id: "chest", label: "Chest", muscles: ["chest"] },
  { id: "back", label: "Back", muscles: ["lats", "middle-back", "lower-back", "traps"] },
  { id: "shoulders", label: "Shoulders", muscles: ["shoulders", "neck"] },
  { id: "arms", label: "Arms", muscles: ["biceps", "triceps", "forearms"] },
  { id: "legs", label: "Legs", muscles: ["quadriceps", "hamstrings", "glutes", "calves", "abductors", "adductors"] },
  { id: "core", label: "Core", muscles: ["abdominals"] },
  { id: "cardio", label: "Cardio", category: "cardio" },
  { id: "stretching", label: "Stretching", category: "stretching" },
];

const SPECIAL_CATEGORIES = new Set(["cardio", "stretching"]);

export function inArea(item: ExerciseItem, area: ExerciseArea): boolean {
  const spec = EXERCISE_AREAS.find((entry) => entry.id === area);
  if (!spec || area === "all") return true;
  if (spec.category) return item.category === spec.category;
  if (SPECIAL_CATEGORIES.has(item.category)) return false;
  return item.primaryMuscles.some((muscle) => spec.muscles!.includes(muscle));
}

const EQUIPMENT: Record<string, string> = {
  bodyweight: "Bodyweight",
  "ez-bar": "EZ bar",
  none: "No equipment",
  other: "Other equipment",
};

/** "medicine-ball" → "Medicine ball"; a few ids read better as other words. */
export function equipmentLabel(equipment: string): string {
  return EQUIPMENT[equipment] ?? sentence(equipment);
}

/** "middle-back" → "Middle back". */
export function muscleLabel(muscle: string): string {
  return sentence(muscle);
}

function sentence(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The line under a name in the list: "Barbell · Quadriceps". */
export function exerciseLine(item: ExerciseItem): string {
  const parts = [equipmentLabel(item.equipment)];
  if (item.primaryMuscles.length) parts.push(item.primaryMuscles.map(muscleLabel).join(", "));
  return parts.join(" · ");
}

/** The small line in the how-to sheet: "Barbell · compound · beginner". */
export function exerciseFacts(item: ExerciseItem): string {
  return [equipmentLabel(item.equipment), item.mechanic, item.level].filter(Boolean).join(" · ");
}

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Hybrid: the Hyrox stations and the moves hybrid training is built from. A cross-cut, so each is also under its
 * own type (SkiErg under Cardio, the kettlebell swing under Strength).
 */
export const HYBRID_IDS: ReadonlySet<string> = new Set([
  "skierg", "sled-push", "sled-pull", "burpee-broad-jump", "rowing-stationary", "farmers-walk", "sandbag-lunge",
  "wall-ball", "run", "fan-bike", "kettlebell-swing", "kettlebell-thruster", "mountain-climbers",
]);

export type ExerciseType = "all" | "strength" | "hybrid" | "olympic" | "plyometric" | "strongman" | "cardio" | "stretching";

/** The first row under the search: what kind of training. A filter, one at a time. */
export const EXERCISE_TYPES: { id: ExerciseType; label: string; icon?: string; categories?: string[] }[] = [
  { id: "all", label: "All" },
  { id: "strength", label: "Strength", icon: "dumbbell", categories: ["strength", "powerlifting"] },
  { id: "hybrid", label: "Hybrid", icon: "bolt" },
  { id: "olympic", label: "Olympic", icon: "trophy", categories: ["olympic weightlifting"] },
  { id: "plyometric", label: "Plyometric", icon: "bolt", categories: ["plyometrics"] },
  { id: "strongman", label: "Strongman", icon: "trophy", categories: ["strongman"] },
  { id: "cardio", label: "Cardio", icon: "pulse", categories: ["cardio"] },
  { id: "stretching", label: "Stretching", icon: "stretch", categories: ["stretching"] },
];

export function ofType(item: ExerciseItem, type: ExerciseType): boolean {
  if (type === "all") return true;
  if (type === "hybrid") return HYBRID_IDS.has(item.id);
  return EXERCISE_TYPES.find((entry) => entry.id === type)?.categories?.includes(item.category) ?? false;
}

/** The type named on a row when the list shows every type: Hybrid first, since it cuts across the others. */
export function typeLabel(item: ExerciseItem): string {
  if (HYBRID_IDS.has(item.id)) return "Hybrid";
  return EXERCISE_TYPES.find((entry) => entry.categories?.includes(item.category))?.label ?? "Strength";
}

export type MuscleGroup = "all" | "chest" | "back" | "shoulders" | "arms" | "legs" | "core";

/** The second row: the muscle groups the list swipes between, All first. */
export const MUSCLE_GROUPS = EXERCISE_AREAS.filter((area) => area.id === "all" || area.muscles) as { id: MuscleGroup; label: string; muscles?: string[] }[];

/** By the main muscles whatever the type, so a hamstring stretch is under Legs once Stretching is picked. */
export function inGroup(item: ExerciseItem, group: MuscleGroup): boolean {
  if (group === "all") return true;
  const muscles = MUSCLE_GROUPS.find((entry) => entry.id === group)?.muscles ?? [];
  return item.primaryMuscles.some((muscle) => muscles.includes(muscle));
}

/** Explore's body-area chips open the library on a type (Cardio, Stretching) or a muscle group. */
export function areaFilter(area: ExerciseArea): { type: ExerciseType; group: MuscleGroup } {
  if (area === "cardio" || area === "stretching") return { type: area, group: "all" };
  return { type: "all", group: area };
}

/** The lifts and stations most people look for, first in a list so it doesn't open on Ab Crunch Machine. */
export const COMMON_EXERCISES: readonly string[] = [
  "barbell-squat", "barbell-bench-press-medium-grip", "barbell-deadlift", "bent-over-barbell-row", "standing-military-press",
  "pullups", "pushups", "romanian-deadlift", "dumbbell-bench-press", "leg-press", "wide-grip-lat-pulldown", "seated-cable-rows",
  "barbell-hip-thrust", "incline-dumbbell-press", "goblet-squat", "dumbbell-lunges", "side-lateral-raise", "barbell-curl",
  "triceps-pushdown", "lying-leg-curls", "plank", "power-clean", "clean-and-jerk", "snatch", "push-press", "run",
  "rowing-stationary", "skierg", "sled-push", "sled-pull", "wall-ball", "farmers-walk", "kettlebell-swing",
  "burpee-broad-jump", "sandbag-lunge", "fan-bike",
];
const commonRank = new Map(COMMON_EXERCISES.map((id, at) => [id, at]));

/** Words a search finds an exercise by besides its name, equipment and muscles: its type ("hyrox", "weightlifting"). */
const TYPE_WORDS: Record<string, string[]> = {
  strength: ["strength"],
  powerlifting: ["powerlifting", "strength"],
  "olympic weightlifting": ["olympic", "weightlifting", "lifting", "oly"],
  plyometrics: ["plyometric", "plyometrics", "plyo"],
  strongman: ["strongman"],
  cardio: ["cardio", "conditioning"],
  stretching: ["stretching", "stretch", "mobility"],
};

/**
 * The exercises of `type` in `group` that match every word of `query`, each word as the start of a word in the
 * name, the equipment, a main muscle or the type ("db" doesn't match; "dumb row" finds Dumbbell rows; "hyrox"
 * finds the stations). Names starting with the query come first, then names holding every word, then the rest;
 * within each, the common lifts first, then by name.
 */
export function searchExercises(items: readonly ExerciseItem[], query: string, type: ExerciseType = "all", group: MuscleGroup = "all"): ExerciseItem[] {
  const wanted = words(query);
  const found: { item: ExerciseItem; rank: number }[] = [];
  for (const item of items) {
    if (!ofType(item, type) || !inGroup(item, group)) continue;
    if (!wanted.length) {
      found.push({ item, rank: 0 });
      continue;
    }
    const name = words(item.name);
    const more = [
      ...words(equipmentLabel(item.equipment)), ...item.primaryMuscles.flatMap(words), ...(TYPE_WORDS[item.category] ?? []),
      ...(HYBRID_IDS.has(item.id) ? ["hybrid", "hyrox"] : []), ...(item.mechanic ? [item.mechanic] : []),
    ];
    const inName = (word: string) => name.some((part) => part.startsWith(word));
    if (!wanted.every((word) => inName(word) || more.some((part) => part.startsWith(word)))) continue;
    const starts = wanted.every((word, index) => name[index]?.startsWith(word) ?? false);
    found.push({ item, rank: starts ? 0 : wanted.every(inName) ? 1 : 2 });
  }
  const common = (item: ExerciseItem) => commonRank.get(item.id) ?? COMMON_EXERCISES.length;
  return found
    .sort((a, b) => a.rank - b.rank || common(a.item) - common(b.item) || a.item.name.localeCompare(b.item.name, "en", { sensitivity: "base" }))
    .map((entry) => entry.item);
}

/** Recently done exercises, newest first and each once, from workouts listed newest first. */
export function recentExercises(workouts: readonly { exercises: readonly string[] }[], max = 6): string[] {
  const seen: string[] = [];
  for (const workout of workouts) {
    for (const id of workout.exercises) {
      if (!seen.includes(id)) seen.push(id);
      if (seen.length >= max) return seen;
    }
  }
  return seen;
}

/** A photo's address: `base` is the folder the API names (`photos`), so a native build can point it elsewhere. */
export function photoUrl(base: string, id: string, index: number): string {
  return `${base}/${encodeURIComponent(id)}/${index}.webp`;
}

/** No video is hosted: "Watch a demo" opens a YouTube search for the exercise. */
export function demoUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise form`)}`;
}

/** Library rows drawn at a time: a long list grows by this much as you near its end, so 886 rows never draw at once. */
export const LIST_STEP = 40;

/** How many of `total` rows to draw after asking for more: one step more, never past the end. */
export function moreRows(shown: number, total: number, step = LIST_STEP): number {
  return Math.min(total, Math.max(shown, 0) + step);
}
