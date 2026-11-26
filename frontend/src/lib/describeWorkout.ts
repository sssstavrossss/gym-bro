// "Describe a workout" (docs/training.md, phase 6; README → Describe a workout): the words go to the server,
// which names library exercises and the sets the words give. These rules turn its answer into the workout's
// exercises: each set with a value comes in ticked off, as done; one with none is left to fill in.
import type { DescribedWorkoutExercise } from "../api";
import { emptySet, type DraftExercise, type DraftSet } from "./workout";

/** As the server allows (`WorkoutDescriber.MaxText`). */
export const DESCRIBE_WORKOUT_MAX = 500;

export const describeWorkoutPlaceholder = "Squat 3x5 100 kg, bench 3x8 60 kg, 5 km run in 26 min";

export const describeWorkoutHint = "Name each exercise with its sets. Weights come only from what you write.";

export const describeWorkoutNote = "Claude reads the words. Check the sets before you finish.";

/** The words are worth sending: something besides spaces, within the limit. */
export function canDescribe(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= DESCRIBE_WORKOUT_MAX;
}

/** The server's exercises as the workout's own, with fresh keys. A set with a value is done at `doneAt`. */
export function describedExercises(found: DescribedWorkoutExercise[], keyOf: () => string, doneAt: string): DraftExercise[] {
  return found.map((exercise, index) => ({
    key: keyOf(),
    exerciseId: exercise.exerciseId,
    ...(exercise.superset && index > 0 ? { superset: true } : {}),
    sets: exercise.sets.length ? exercise.sets.map((set): DraftSet => {
      const values = { kg: set.kg, reps: set.reps, rir: null, seconds: set.seconds, metres: set.metres };
      const any = values.kg != null || values.reps != null || values.seconds != null || values.metres != null;
      return { type: "working", ...values, doneAt: any ? doneAt : null };
    }) : [emptySet()],
  }));
}

/** The toast once they are in: "Added 3 exercises, 9 sets". */
export function describedLine(added: DraftExercise[]): string {
  const sets = added.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.doneAt).length, 0);
  const exercises = added.length === 1 ? "1 exercise" : `${added.length} exercises`;
  return sets ? `Added ${exercises}, ${sets === 1 ? "1 set" : `${sets} sets`}` : `Added ${exercises}`;
}

/** What the library didn't have, to add by hand. Empty when everything matched. */
export function unmatchedLine(unmatched: string[]): string {
  if (!unmatched.length) return "";
  const names = unmatched.map((name) => `“${name}”`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Couldn't find ${list} in the library. Add ${unmatched.length === 1 ? "it" : "them"} with + Exercise.`;
}
