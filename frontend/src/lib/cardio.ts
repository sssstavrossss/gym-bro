// Cardio in a workout (docs/training.md, phase 6): a run, ride, row or swim is a set with a distance and a time, and
// these turn them into the words you'd use: "5 km", a pace in the unit that sport counts in, and the workout's distance.
import { clock, type DraftExercise, type WorkoutSetValues } from "./workout";

/** How a sport says its pace: per km (run, walk), per 500 m (row, ski), per 100 m (swim), or speed (bike). */
export type PaceUnit = "km" | "500m" | "100m" | "kmh";

const PACE_UNITS: Record<string, PaceUnit> = {
  run: "km",
  walk: "km",
  "running-treadmill": "km",
  "jogging-treadmill": "km",
  "walking-treadmill": "km",
  "trail-running-walking": "km",
  "rowing-stationary": "500m",
  skierg: "500m",
  swim: "100m",
  bicycling: "kmh",
  "bicycling-stationary": "kmh",
  "recumbent-bike": "kmh",
  "fan-bike": "kmh",
};

/** The pace unit for an exercise, or null where a distance has no usual pace (a stair climber, a skipping rope). */
export function paceUnit(exerciseId: string): PaceUnit | null {
  return PACE_UNITS[exerciseId] ?? null;
}

/** "800 m", "5 km", "21.1 km": metres up to 1 km, then km to 2 decimals at most. */
export function distanceText(metres: number): string {
  if (metres < 1000) return `${Math.round(metres * 10) / 10} m`;
  return `${(Math.round(metres / 10) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} km`;
}

/** "5:00 /km", "1:52 /500 m", "2:05 /100 m" or "24.5 km/h"; empty without both a distance and a time. */
export function paceText(metres: number | null, seconds: number | null, unit: PaceUnit | null): string {
  if (!unit || !metres || !seconds) return "";
  if (unit === "kmh") return `${(Math.round((metres / seconds) * 36) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1 })} km/h`;
  const per = unit === "km" ? 1000 : unit === "500m" ? 500 : 100;
  return `${clock(Math.round((seconds / metres) * per))} /${unit === "km" ? "km" : unit === "500m" ? "500 m" : "100 m"}`;
}

/** A distance-and-time set in words: "5 km · 25:00 · 5:00 /km". */
export function cardioSet(set: Pick<WorkoutSetValues, "metres" | "seconds">, unit: PaceUnit | null): string {
  const parts = [
    set.metres != null ? distanceText(set.metres) : null,
    set.seconds != null ? clock(set.seconds) : null,
    paceText(set.metres, set.seconds, unit) || null,
  ];
  return parts.filter(Boolean).join(" · ") || "—";
}

/**
 * The pace line under an open cardio exercise: the set being typed, else the last one with a distance and a time.
 * "Pace 5:00 /km". Empty when no set has both.
 */
export function paceLine(exercise: DraftExercise, editing: number | null): string {
  const unit = paceUnit(exercise.exerciseId);
  if (!unit) return "";
  const set = editing != null ? exercise.sets[editing] : [...exercise.sets].reverse().find((each) => each.metres && each.seconds);
  const pace = set ? paceText(set.metres, set.seconds, unit) : "";
  return pace ? `${unit === "kmh" ? "Speed" : "Pace"} ${pace}` : "";
}
