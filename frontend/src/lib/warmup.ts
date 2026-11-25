// Warm-up sets worked out from the working weight (docs/training.md, phase 5): fixed rules, like load suggestions.
import { loadStep } from "./progression";
import type { DraftSet } from "./workout";

export interface WarmupSet {
  kg: number;
  reps: number;
}

/** An Olympic bar's weight: a barbell warm-up never goes under it. */
export const BAR_KG = 20;

/** A compound ramps up in three sets; an isolation move takes one. */
const COMPOUND = [
  { share: 0.4, reps: 8 },
  { share: 0.6, reps: 5 },
  { share: 0.8, reps: 3 },
];
const ISOLATION = [{ share: 0.5, reps: 10 }];

/**
 * The warm-ups before a working weight, lightest first, each to the kit's load step. A barbell compound starts
 * with the empty bar for 10 when the work is at least two bars, and no barbell warm-up goes under the bar. A
 * warm-up as heavy as the work, or no heavier than the one before, is left out. None for kit whose load doesn't
 * step (body weight, bands).
 */
export function warmupRamp(workKg: number, equipment: string | null | undefined, mechanic: string | null | undefined): WarmupSet[] {
  const step = loadStep(equipment);
  if (step == null || !(workKg > 0)) return [];
  const barbell = equipment === "barbell";
  const compound = mechanic === "compound";
  const ramp: WarmupSet[] = [];
  if (barbell && compound && workKg >= 2 * BAR_KG) ramp.push({ kg: BAR_KG, reps: 10 });
  for (const { share, reps } of compound ? COMPOUND : ISOLATION) {
    let kg = Math.round((Math.round((workKg * share) / step) * step) * 4) / 4;
    if (barbell) kg = Math.max(kg, BAR_KG);
    if (kg <= 0 || kg >= workKg || (ramp.length && kg <= ramp[ramp.length - 1].kg)) continue;
    ramp.push({ kg, reps });
  }
  return ramp;
}

/** The weight to warm up for: the first working set's typed weight, else the suggestion's, else last time's heaviest. */
export function workingKg(
  sets: readonly Pick<DraftSet, "type" | "kg">[],
  suggestedKg: number | null | undefined,
  lastTime: readonly { type: string; kg: number | null }[],
): number | null {
  const typed = sets.find((set) => set.type === "working" && set.kg != null && set.kg > 0)?.kg;
  if (typed != null) return typed;
  if (suggestedKg != null && suggestedKg > 0) return suggestedKg;
  const last = lastTime.filter((set) => set.type !== "warmup" && set.kg != null && set.kg > 0).map((set) => set.kg!);
  return last.length ? Math.max(...last) : null;
}
