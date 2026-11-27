// Training on Home's week strip and calendar: the history, workouts waiting to send and the plan's coming days, as
// lib/trainingDays.ts reads them. Reactive: call it inside a computed and it follows the stores.
import { projectDays, upNext } from "../lib/plan";
import { trainingByDay, type DayWorkout } from "../lib/trainingDays";
import { loadPlan, plan } from "./plan";
import { loadHistory, workout, workoutHistory } from "./workout";

/** Loads the plan and the workout history if nothing has yet (Home's training card and Train load the same). */
export function loadTrainingDays(): void {
  if (plan.state === "idle" || plan.state === "failed") void loadPlan();
  if (workoutHistory.state === "idle" || workoutHistory.state === "failed") void loadHistory();
}

/** About a year of the plan's coming days, so a week paged ahead still shows its workouts. */
const WEEKS_AHEAD = 53;

export function trainingDays(today: string): Record<string, DayWorkout[]> {
  const current = plan.current;
  let coming: ReturnType<typeof projectDays> = [];
  if (current) {
    const next = upNext(current, workout.pending.flatMap((draft) => (draft.plan ? [draft.plan] : [])));
    const doneToday = workoutHistory.rows.some((row) => row.planWorkoutId != null && row.date === today)
      || workout.pending.some((draft) => draft.plan && draft.date === today);
    if (next) coming = projectDays(current, next, today, doneToday, current.weekdays.length * WEEKS_AHEAD);
  }
  return trainingByDay(workoutHistory.rows, workout.pending, coming, current?.kinds);
}
