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
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The exercises in `area` that match every word of `query`, each word as the start of a word in the name, the
 * equipment or a main muscle ("db" doesn't match; "dumb row" finds Dumbbell rows). Names starting with the query
 * come first, then names holding every word, then matches on equipment or muscle; by name within each.
 */
export function searchExercises(items: readonly ExerciseItem[], query: string, area: ExerciseArea): ExerciseItem[] {
  const wanted = words(query);
  const found: { item: ExerciseItem; rank: number }[] = [];
  for (const item of items) {
    if (!inArea(item, area)) continue;
    if (!wanted.length) {
      found.push({ item, rank: 0 });
      continue;
    }
    const name = words(item.name);
    const more = [...words(equipmentLabel(item.equipment)), ...item.primaryMuscles.flatMap(words)];
    const inName = (word: string) => name.some((part) => part.startsWith(word));
    if (!wanted.every((word) => inName(word) || more.some((part) => part.startsWith(word)))) continue;
    const starts = wanted.every((word, index) => name[index]?.startsWith(word) ?? false);
    found.push({ item, rank: starts ? 0 : wanted.every(inName) ? 1 : 2 });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, "en", { sensitivity: "base" }))
    .map((entry) => entry.item);
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
