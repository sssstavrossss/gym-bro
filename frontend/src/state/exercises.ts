import { markRaw, reactive } from "vue";
import { getExercises } from "../api";
import type { ExerciseItem } from "../lib/exercises";

/** The exercise library, loaded once a session when the Train tab first opens. */
export const exercises = reactive({
  items: [] as ExerciseItem[],
  /** The photo folder the API names. */
  photos: "",
  state: "idle" as "idle" | "loading" | "ready" | "failed",
});

let loading: Promise<void> | null = null;

export function loadExercises(): Promise<void> {
  if (exercises.state === "ready") return Promise.resolve();
  loading ??= (async () => {
    exercises.state = "loading";
    try {
      const response = await getExercises();
      // Read-only reference data: no need to make 884 rows deeply reactive.
      exercises.items = markRaw(response.exercises);
      exercises.photos = response.photos;
      exercises.state = "ready";
    } catch {
      exercises.state = "failed";
    } finally {
      loading = null;
    }
  })();
  return loading;
}
