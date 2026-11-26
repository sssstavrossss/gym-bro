import { reactive } from "vue";
import { describeWorkout, ServerUnreachable } from "../api";
import { canDescribe, describedLine, unmatchedLine } from "../lib/describeWorkout";
import { toast } from "../ui";
import { describe, loadDescribe } from "./describe";
import { addDescribed } from "./workout";

// The workout sheet's "Describe": the words stay here while the sheet moves between screens.

export const workoutDescribe = reactive({
  text: "",
  finding: false,
  error: "",
  /** What the last description named that the library doesn't have, shown on the workout until dismissed. */
  unmatched: "",
});

let gen = 0;

export function resetWorkoutDescribe(): void {
  gen += 1;
  Object.assign(workoutDescribe, { text: "", finding: false, error: "", unmatched: "" });
}

/** Sends the words, adds what comes back. Returns the first added exercise's key, or null when nothing was. */
export async function findExercises(): Promise<string | null> {
  if (workoutDescribe.finding || !canDescribe(workoutDescribe.text)) return null;
  const mine = ++gen;
  workoutDescribe.finding = true;
  workoutDescribe.error = "";
  try {
    const result = await describeWorkout(workoutDescribe.text.trim());
    if (mine !== gen) return null;
    describe.left = result.left;
    if (result.left === 0) void loadDescribe();
    const added = await addDescribed(result.exercises);
    workoutDescribe.text = "";
    workoutDescribe.unmatched = unmatchedLine(result.unmatched);
    toast(describedLine(added));
    return added[0]?.key ?? null;
  } catch (error) {
    if (mine !== gen) return null;
    if (error instanceof ServerUnreachable) workoutDescribe.error = "Server unreachable, try again.";
    else workoutDescribe.error = error instanceof Error && error.message ? error.message : "Couldn't read that workout.";
    return null;
  } finally {
    if (mine === gen) workoutDescribe.finding = false;
  }
}
