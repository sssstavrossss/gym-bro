// Load suggestions: double progression with reps in reserve (docs/training.md → Rules). Fixed rules, no AI.

/** A logged set, as far as the rules need it. */
export interface LoggedSet {
  type: "warmup" | "working" | "drop";
  kg: number | null;
  reps: number | null;
  rir: number | null;
}

/** What the exercise aims for: a plan's target, or the default range for a free workout (no effort target). */
export interface LoadTarget {
  repMin: number;
  repMax: number;
  /** Reps in reserve to stay at or above; null takes any effort. */
  rir: number | null;
  /** The plan's first weeks of Ease in: half steps. */
  easing: boolean;
}

export type SuggestionKind = "up" | "hold" | "ease";

export interface LoadSuggestion {
  kind: SuggestionKind;
  /** The weight to use on working sets. */
  kg: number;
  /** The change from last time, in kg (0 for hold). */
  change: number;
  /** Reps to start from after a step up: the bottom of the range. Null keeps last time's. */
  reps: number | null;
  /** The weight last time, for the line. */
  lastKg: number;
}

/** Equipment with a load that steps, and its smallest step in kg (a pair of 1.25 plates, the next dumbbell, the next bell). */
const STEPS: Record<string, number> = {
  barbell: 2.5,
  "ez-bar": 2.5,
  cable: 2.5,
  machine: 2.5,
  other: 2.5,
  dumbbell: 2,
  kettlebell: 4,
};

/** Kit that can take a half step: microplates on a bar, the half plate on a stack. Dumbbells and bells come in fixed sizes. */
const HALVES = new Set(["barbell", "ez-bar", "cable", "machine", "other"]);

/** The smallest load step for the kit, or null when the load doesn't step (body weight, bands, balls). */
export function loadStep(equipment: string | null | undefined): number | null {
  return STEPS[equipment ?? ""] ?? null;
}

/** Compounds aim for 6–10 reps, isolation for 10–15 (docs/training.md → Rules). */
export function defaultRange(mechanic: string | null | undefined): { repMin: number; repMax: number } {
  return mechanic === "compound" ? { repMin: 6, repMax: 10 } : { repMin: 10, repMax: 15 };
}

/**
 * The rep range and effort an exercise progresses against: the plan's target, else the default for the kind of lift.
 * Null for anything not weight × reps, and for a plan's timed hold.
 */
export function loadTargetOf(
  target: { repMin: number | null; repMax: number | null; seconds: number | null; rir: number; easing?: boolean } | null | undefined,
  measure: string,
  mechanic: string | null | undefined,
): LoadTarget | null {
  if (measure !== "weight_reps" || target?.seconds != null) return null;
  if (target?.repMin != null && target.repMax != null) return { repMin: target.repMin, repMax: target.repMax, rir: target.rir, easing: !!target.easing };
  return { ...defaultRange(mechanic), rir: null, easing: false };
}

/** Working sets with a weight and reps. */
function working(sets: readonly LoggedSet[]): { kg: number; reps: number; rir: number | null }[] {
  return sets.flatMap((set) => (set.type === "working" && set.kg != null && set.kg > 0 && set.reps != null ? [{ kg: set.kg, reps: set.reps, rir: set.rir }] : []));
}

/** The heaviest working weight, and the sets done at it. */
function topSets(sets: readonly LoggedSet[]) {
  const rows = working(sets);
  if (!rows.length) return null;
  const kg = Math.max(...rows.map((row) => row.kg));
  return { kg, sets: rows.filter((row) => row.kg === kg) };
}

const missed = (top: NonNullable<ReturnType<typeof topSets>>, target: LoadTarget) => top.sets.some((set) => set.reps < target.repMin);

/** To the nearest 0.25 kg, the finest a set is saved to. */
const quarter = (kg: number) => Math.round(kg * 4) / 4;

/**
 * The next session's weight from the last one (and the one before):
 * - every set at the top weight reached the top of the range, at or under the target effort: one step up;
 * - a set missed the bottom of the range for the second time running at this weight or more: about 10% down;
 * - otherwise the same weight.
 * The step is the kit's smallest. On a bar or a stack it's halved when easing in, or when it would be more than 10%.
 * Null when there's nothing to go on: no weighted working sets last time, or kit that doesn't step.
 */
export function suggestLoad(
  last: readonly LoggedSet[],
  earlier: readonly LoggedSet[] | null,
  target: LoadTarget,
  equipment: string | null | undefined,
): LoadSuggestion | null {
  const step = loadStep(equipment);
  const top = topSets(last);
  if (step == null || !top) return null;
  const halves = HALVES.has(equipment ?? "");
  const up = halves && (target.easing || step > top.kg * 0.1) ? step / 2 : step;
  const reachedTop = top.sets.every((set) => set.reps >= target.repMax && (target.rir == null || set.rir == null || set.rir >= target.rir));
  if (reachedTop) return { kind: "up", kg: quarter(top.kg + up), change: up, reps: target.repMin, lastKg: top.kg };

  const before = earlier ? topSets(earlier) : null;
  if (missed(top, target) && before && before.kg >= top.kg && missed(before, target)) {
    const down = Math.max(step, Math.round((top.kg * 0.1) / step) * step);
    const kg = quarter(top.kg - down);
    if (kg > 0) return { kind: "ease", kg, change: -down, reps: null, lastKg: top.kg };
  }
  return { kind: "hold", kg: top.kg, change: 0, reps: null, lastKg: top.kg };
}

const kgText = (kg: number) => `${Number(kg.toFixed(2))} kg`;

/** The line under an exercise's target: "Try 62.5 kg, up 2.5: every set reached 10 last time". */
export function suggestionLine(suggestion: LoadSuggestion, target: Pick<LoadTarget, "repMax">): string {
  switch (suggestion.kind) {
    case "up":
      return `Try ${kgText(suggestion.kg)}, up ${Number(suggestion.change.toFixed(2))}: every set reached ${target.repMax} last time`;
    case "ease":
      return `Try ${kgText(suggestion.kg)}, down ${Number((-suggestion.change).toFixed(2))}: short of the range twice`;
    case "hold":
      return `Stay at ${kgText(suggestion.kg)} until every set reaches ${target.repMax}`;
  }
}

/** Said the first time an exercise is done, when there is nothing to suggest from. */
export const FIRST_TIME_LINE = "First time: pick a weight that leaves about 3 reps";
