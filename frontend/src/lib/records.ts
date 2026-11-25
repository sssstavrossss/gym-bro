// Personal records: estimated max by Epley with reps in reserve (docs/training.md → Rules), the same rule as
// the API's Training/EstimatedMax.cs.

/** Past this many reps the estimate drifts too far to call a best. */
export const MAX_REPS = 20;

export interface ScoredSet {
  type: "warmup" | "working" | "drop";
  kg: number | null;
  reps: number | null;
  rir: number | null;
}

/** kg × (1 + (reps + RIR) / 30), to 2 decimals. Only working sets with a weight and 1–20 reps; no RIR counts as 0. */
export function estimatedMax(set: ScoredSet): number | null {
  if (set.type !== "working" || set.kg == null || set.kg <= 0 || set.reps == null || set.reps < 1 || set.reps > MAX_REPS) return null;
  return Math.round(((set.kg * (30 + set.reps + Math.max(0, set.rir ?? 0))) / 30) * 100) / 100;
}

export interface Best {
  kg: number;
  reps: number;
  rir: number | null;
  estimatedMax: number;
}

/** The set with the highest estimated max; the first one wins a tie. */
export function bestOf(sets: readonly ScoredSet[]): Best | null {
  let best: Best | null = null;
  for (const set of sets) {
    const score = estimatedMax(set);
    if (score != null && (!best || score > best.estimatedMax)) best = { kg: set.kg!, reps: set.reps!, rir: set.rir, estimatedMax: score };
  }
  return best;
}

export interface NewBest extends Best {
  exerciseId: string;
  /** The best before, which this beats. */
  was: number;
}

/**
 * This workout's new bests: for each exercise done before, its best ticked set when that beats the best so far.
 * An exercise done for the first time sets a baseline, not a record.
 */
export function newBests(
  exercises: readonly { exerciseId: string; sets: readonly (ScoredSet & { doneAt: string | null })[] }[],
  before: (exerciseId: string) => { estimatedMax: number } | null | undefined,
): NewBest[] {
  const found: NewBest[] = [];
  const seen = new Set<string>();
  for (const { exerciseId } of exercises) {
    if (seen.has(exerciseId)) continue;
    seen.add(exerciseId);
    const was = before(exerciseId);
    if (!was) continue;
    const sets = exercises.filter((item) => item.exerciseId === exerciseId).flatMap((item) => item.sets.filter((set) => set.doneAt));
    const best = bestOf(sets);
    if (best && best.estimatedMax > was.estimatedMax) found.push({ ...best, exerciseId, was: was.estimatedMax });
  }
  return found;
}

/** Estimated max for show, to the nearest 0.5 kg: "123.5 kg". */
export function maxText(kg: number): string {
  return `${Math.round(kg * 2) / 2} kg`;
}

/** "est. max 123.5 kg, up 2.5": the summary's words for a new best (the set is on the same row). */
export function newBestLine(best: NewBest): string {
  const up = Math.round(best.estimatedMax * 2) / 2 - Math.round(best.was * 2) / 2;
  return up > 0 ? `est. max ${maxText(best.estimatedMax)}, up ${up}` : `est. max ${maxText(best.estimatedMax)}`;
}
