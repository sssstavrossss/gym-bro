import { exerciseGroups, formatSet, type DraftExercise, type DraftSet, type DraftWorkout, type SavedSet, type SetField, type WorkoutSetValues } from "./workout";
import type { ExerciseMeasure } from "./exercises";

// The exercise screen of a quick workout (README, *Logging a workout*): one set at a time, like a food's amount
// screen. The sets done so far are listed, the next one is typed in the footer and logged with one tap.

/** A quick workout's exercise on its own gets the screen; a plan's, a superset's and a clocked block keep the table. */
export function usesSetScreen(workout: Pick<DraftWorkout, "plan" | "exercises"> | null | undefined, key: string): boolean {
  if (!workout || workout.plan) return false;
  const run = exerciseGroups(workout.exercises).find((group) => group.some((exercise) => exercise.key === key));
  return !!run && run.length === 1 && !run[0].timed;
}

/** W for a warm-up, D for a drop set, else the working set's number. */
export function setLabels(sets: readonly Pick<DraftSet, "type">[]): string[] {
  let n = 0;
  return sets.map((set) => (set.type === "warmup" ? "W" : set.type === "drop" ? "D" : String(++n)));
}

/** "Set 3", "Warm-up set 2", "Drop set". One past the end is the set that a log would add. */
export function setName(sets: readonly Pick<DraftSet, "type">[], index: number): string {
  if (index >= sets.length) return `Set ${sets.filter((set) => set.type !== "warmup" && set.type !== "drop").length + 1}`;
  const labels = setLabels(sets);
  const label = labels[index];
  if (label === "D") return "Drop set";
  if (label !== "W") return `Set ${label}`;
  const warmups = labels.filter((each) => each === "W").length;
  return warmups > 1 ? `Warm-up set ${labels.slice(0, index + 1).filter((each) => each === "W").length}` : "Warm-up set";
}

/** The set to log next: the first not ticked off, else one more after the last. */
export function nextSetIndex(sets: readonly Pick<DraftSet, "doneAt">[]): number {
  const at = sets.findIndex((set) => !set.doneAt);
  return at < 0 ? sets.length : at;
}

/** The header's second line: the set being typed, "Editing set 2" for one done, or "3 of 3 done · one more?". */
export function screenStatus(sets: readonly Pick<DraftSet, "type" | "doneAt">[], index: number): string {
  const working = sets.filter((set) => set.type === "working").length;
  if (index >= sets.length) return working ? `${working} of ${working} done · one more?` : setName(sets, index);
  if (sets[index].doneAt) return `Editing ${setName(sets, index).toLowerCase()}`;
  return sets[index].type === "working" ? `${setName(sets, index)} of ${working}` : setName(sets, index);
}

/**
 * "Same as" fills the set from the one before it, else the same set last time: what is most often done again.
 * Null when there is neither.
 */
export function sameAs(exercise: Pick<DraftExercise, "sets">, index: number, lastTime: readonly SavedSet[], measure: ExerciseMeasure): { label: string; values: WorkoutSetValues } | null {
  const set = exercise.sets[index];
  const warmup = set?.type === "warmup";
  const before = [...exercise.sets.slice(0, index)].reverse().find((each) => each.doneAt && (each.type === "warmup") === warmup);
  if (before) return { label: `Same as before · ${formatSet(before, measure)}`, values: pick(before) };
  if (warmup) return null;
  const working = exercise.sets.slice(0, index).filter((each) => each.type !== "warmup").length;
  const last = lastTime.filter((each) => each.type !== "warmup")[working];
  return last ? { label: `Same as last time · ${formatSet(last, measure)}`, values: pick(last) } : null;
}

function pick(set: WorkoutSetValues): WorkoutSetValues {
  return { kg: set.kg, reps: set.reps, rir: set.rir, seconds: set.seconds, metres: set.metres };
}

/** A step up or down on a field, from what it shows (typed, else its hint); never below 0. */
export function stepped(field: SetField, shown: number | null, delta: number): number {
  const next = Math.max(0, (shown ?? 0) + delta);
  return field === "kg" ? Math.round(next * 100) / 100 : Math.round(next);
}
