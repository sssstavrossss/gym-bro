// Progress → Strength's This week: sets per muscle against the weekly target (docs/training.md → Rules → Volume).
import { muscleLabel } from "./exercises";

export interface MuscleSets {
  muscle: string;
  /** Main-muscle sets in full, helping ones as half. */
  sets: number;
  direct: number;
  helping: number;
  /** Days it was worked as a main muscle. */
  days: number;
}

export interface VolumeTarget {
  low: number;
  high: number;
}

export type VolumeStatus = "under" | "on" | "over";

/** The muscles a week of training should reach, as the library names them, for "Not yet this week". */
export const MAJOR_MUSCLES = ["chest", "lats", "middle-back", "shoulders", "biceps", "triceps", "quadriceps", "hamstrings", "glutes", "calves", "abdominals"] as const;

export function volumeStatus(sets: number, target: VolumeTarget): VolumeStatus {
  if (sets < target.low) return "under";
  return sets > target.high ? "over" : "on";
}

const count = (sets: number) => `${sets} ${sets === 1 ? "set" : "sets"}`;

/** "7.5 sets", "1 set". */
export const setsText = count;

/** "2.5 to go · 1 day", "On target · 2 days", "4 over · 3 days". */
export function volumeLine(muscle: Pick<MuscleSets, "sets" | "days">, target: VolumeTarget): string {
  const status = volumeStatus(muscle.sets, target);
  const words = status === "under" ? `${target.low - muscle.sets} to go` : status === "on" ? "On target" : `${muscle.sets - target.high} over`;
  if (!muscle.days) return `${words} · helping only`;
  return `${words} · ${muscle.days} ${muscle.days === 1 ? "day" : "days"}`;
}

/** The body map's two tones: at or over the target in full, under it dimmer. */
export function mapTones(muscles: readonly Pick<MuscleSets, "muscle" | "sets">[], target: VolumeTarget): { primary: string[]; secondary: string[] } {
  const primary: string[] = [];
  const secondary: string[] = [];
  for (const { muscle, sets } of muscles) {
    if (sets <= 0) continue;
    (sets >= target.low ? primary : secondary).push(muscle);
  }
  return { primary, secondary };
}

/** "Chest, Shoulders and Triceps": the major muscles with no sets yet this week, or "" when every one has some. */
export function notYet(muscles: readonly Pick<MuscleSets, "muscle">[]): string {
  const done = new Set(muscles.map((item) => item.muscle));
  const names = MAJOR_MUSCLES.filter((muscle) => !done.has(muscle)).map(muscleLabel);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Aim for 10–14 sets a muscle (some experience)", or "(no plan, so some experience)". */
export function targetLine(target: VolumeTarget, experience: string | null): string {
  const who = experience === "new" ? "new" : experience === "experienced" ? "experienced" : experience ? "some experience" : "no plan, so some experience";
  return `Aim for ${target.low}–${target.high} sets a muscle (${who})`;
}
