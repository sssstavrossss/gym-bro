// The number wheel ("the arc", components/NumberDial.vue): numbers on a ring round a ✓, drawn on a dark scrim like the
// + fan. It picks numbers instead of the keypad (README, *Picking a number*). Every kind of number in the app is one
// preset here: its unit, its range, our step and two or three others the person can pick. A screen asks for a preset
// and adds what only it knows (the label, a hint, the value now); it never sets steps of its own. The step a person
// picks is remembered per preset (state/dialSteps.ts).

import type { ExerciseItem } from "./exercises";
import { restSeconds, type SetField } from "./workout";

export type DialFormat = "num" | "clock" | "half";

export interface DialPreset {
  unit: string;
  min: number;
  max: number;
  /** The steps offered, smallest first. One step means no step chips. */
  steps: readonly number[];
  /** Our pick, until the person picks another. */
  step: number;
  format?: DialFormat;
  /** Where the wheel starts when there is no value yet. */
  start?: number;
}

export const DIAL_PRESETS = {
  // Body
  // A weigh-in is kept to a tenth of the unit shown; a goal moves in halves and wholes.
  "body.weight": { unit: "kg", min: 30, max: 300, steps: [0.1, 0.5, 1], step: 0.1, start: 80 },
  "body.weight.lb": { unit: "lb", min: 66.2, max: 661.3, steps: [0.1, 0.5, 1, 5], step: 0.1, start: 175 },
  "body.goal": { unit: "kg", min: 30, max: 300, steps: [0.5, 1, 5], step: 0.5, start: 75 },
  "body.goal.lb": { unit: "lb", min: 66.2, max: 661.3, steps: [1, 5, 10], step: 1, start: 165 },
  // Food and water
  "food.grams": { unit: "g", min: 0, max: 2000, steps: [1, 5, 10, 50], step: 5, start: 100 },
  "food.pieces": { unit: "pieces", min: 0, max: 20, steps: [0.5, 1], step: 1, format: "half", start: 1 },
  "water.ml": { unit: "ml", min: 0, max: 3000, steps: [50, 100, 250], step: 250, start: 250 },
  // A set's load, by the kit
  "set.kg.barbell": { unit: "kg", min: 0, max: 500, steps: [1.25, 2.5, 5, 10], step: 2.5, start: 20 },
  "set.kg.dumbbell": { unit: "kg", min: 0, max: 100, steps: [1, 2, 4], step: 2, start: 10 },
  "set.kg.kettlebell": { unit: "kg", min: 0, max: 100, steps: [2, 4], step: 4, start: 16 },
  "set.kg.machine": { unit: "kg", min: 0, max: 500, steps: [1, 2.5, 5], step: 2.5, start: 20 },
  "set.kg.body": { unit: "kg", min: 0, max: 200, steps: [1.25, 2.5, 5], step: 2.5, start: 0 },
  // The rest of a set
  "set.reps": { unit: "reps", min: 0, max: 200, steps: [1], step: 1, start: 8 },
  "set.rir": { unit: "RIR", min: 0, max: 10, steps: [1], step: 1, start: 2 },
  "set.seconds": { unit: "min", min: 0, max: 7200, steps: [1, 5, 15, 60], step: 5, format: "clock", start: 60 },
  "set.metres": { unit: "m", min: 0, max: 50000, steps: [10, 50, 100, 500], step: 100, start: 1000 },
  // Rest between sets: a heavy leg lift starts longer and moves in bigger steps than an arm curl.
  "rest.heavy": { unit: "min", min: 0, max: 600, steps: [15, 30, 60], step: 30, format: "clock", start: 180 },
  "rest.compound": { unit: "min", min: 0, max: 600, steps: [15, 30, 60], step: 15, format: "clock", start: 120 },
  "rest.isolation": { unit: "min", min: 0, max: 600, steps: [5, 15, 30], step: 15, format: "clock", start: 90 },
} as const satisfies Record<string, DialPreset>;

export type DialId = keyof typeof DIAL_PRESETS;

/** Everything the wheel needs for one number. */
export interface DialSpec {
  id: DialId;
  label: string;
  hint?: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  steps: readonly number[];
  step: number;
  format: DialFormat;
  /** A line that follows the number as the wheel turns ("0.3 kg under trend", "150 g · 248 kcal"). */
  live?: (value: number) => string;
}

/**
 * A wheel for one number: the preset plus what the screen knows. `value` null starts at the preset's start.
 * `remembered` is the step this person last kept for the preset; it wins while it is still one on offer.
 */
export function dialSpec(
  id: DialId,
  what: { label: string; hint?: string; value: number | null; min?: number; max?: number; live?: (value: number) => string },
  remembered: number | null = null,
): DialSpec {
  const preset: DialPreset = DIAL_PRESETS[id];
  const min = what.min ?? preset.min;
  const max = what.max ?? preset.max;
  const value = clamp(what.value ?? preset.start ?? min, min, max);
  return {
    id,
    label: what.label,
    hint: what.hint,
    unit: preset.unit,
    value,
    min,
    max,
    steps: preset.steps,
    step: remembered != null && preset.steps.includes(remembered) ? remembered : preset.step,
    format: preset.format ?? "num",
    live: what.live,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const places = (n: number) => (String(n).split(".")[1] ?? "").length;

/** Rounds away float dust: 0.1 + 0.2 is 0.3 here. */
export function tidy(n: number, step: number): number {
  return +n.toFixed(Math.max(places(step), 2));
}

/**
 * The values on the wheel are whole steps from the value it opened on (or the value when the step changed), down to the
 * minimum and up to the maximum, so changing the step never moves the value. Index 0 is the lowest.
 */
export interface Wheel { first: number; step: number; count: number }
export function wheel(anchor: number, step: number, min: number, max: number): Wheel {
  const first = tidy(anchor - Math.floor((anchor - min) / step + 1e-9) * step, step);
  const count = Math.max(1, Math.floor((max - first) / step + 1e-9) + 1);
  return { first, step, count };
}
export const valueAt = (w: Wheel, index: number): number => tidy(w.first + clamp(Math.round(index), 0, w.count - 1) * w.step, w.step);
/** The index of the step nearest a value. */
export const indexOf = (w: Wheel, value: number): number => clamp(Math.round((value - w.first) / w.step), 0, w.count - 1);

/** "1:30" for a clock, "2½" for halves, else the number with as many decimals as the finer of the step and the anchor. */
export function dialText(value: number, format: DialFormat, step: number, anchor = value): string {
  if (format === "clock") {
    const s = Math.round(value);
    return s >= 3600
      ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (format === "half") {
    const whole = Math.floor(value + 1e-9);
    const half = value - whole >= 0.5 - 1e-9 ? "½" : "";
    return whole ? `${whole}${half}` : half || "0";
  }
  // 83.65 picked on the 0.05 step keeps its two decimals on the 0.1 step; 100 on the 2.5 step stays "100".
  const decimals = Math.min(2, Math.max(places(step), places(tidy(anchor, step))));
  return step < 1 && !Number.isInteger(step * 2) ? value.toFixed(decimals) : String(tidy(value, step));
}

/** A step chip's words: "15 s", "1 min", "½", "2.5". */
export function stepText(step: number, format: DialFormat): string {
  if (format === "clock") return step >= 60 ? `${step / 60} min` : `${step} s`;
  if (format === "half" && step === 0.5) return "½";
  return String(step);
}

// The ring: the value picked sits at the top, the others round it, smaller and fainter little by little towards the ends.
export const ARC_RADIUS = 170;
/** Degrees between numbers: longer numbers sit further apart, so 83.65 has the room 1:30 has. */
export function arcGap(text: string): number {
  const n = text.length;
  return n <= 3 ? 20 : n === 4 ? 22 : n === 5 ? 27 : 31;
}
/** Where a number `offset` steps from the middle sits on the ring, and how big and faint it is. */
export function arcPlace(offset: number, gap: number, radius = ARC_RADIUS): { x: number; y: number; scale: number; opacity: number } {
  const angle = offset * gap;
  const rad = (angle * Math.PI) / 180;
  const t = Math.min(1, Math.abs(angle) / 84);
  return {
    x: radius * Math.sin(rad),
    y: -radius * Math.cos(rad),
    scale: 0.5 + 0.85 * (1 - t) ** 1.3,
    opacity: Math.abs(angle) > 88 ? 0 : Math.max(0, 1 - 0.9 * t ** 1.1),
  };
}
/** How many steps a tap `x` px from the ring's middle is, for a tap that goes to the number tapped. */
export function arcSteps(x: number, gap: number, radius = ARC_RADIUS): number {
  return Math.round((Math.asin(clamp(x / radius, -1, 1)) * 180) / Math.PI / gap);
}

/**
 * Digits typed on a keyboard while the wheel is open: a number, or for a clock digits read from the right (230 → 2:30),
 * like the keypad. Null when it isn't a number yet.
 */
export function typedValue(text: string, format: DialFormat): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (format === "clock") {
    if (!/^\d{1,6}$/.test(trimmed)) return null;
    const digits = trimmed.padStart(6, "0");
    return Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60 + Number(digits.slice(4));
  }
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

// ---- Training ----

/** The load preset for the kit. */
export function loadDial(equipment: string | null | undefined): DialId {
  switch (equipment) {
    case "barbell": case "ez-bar": return "set.kg.barbell";
    case "dumbbell": return "set.kg.dumbbell";
    case "kettlebell": return "set.kg.kettlebell";
    case "bodyweight": case "none": return "set.kg.body";
    default: return "set.kg.machine";
  }
}

type RestItem = Pick<ExerciseItem, "category" | "mechanic" | "measure" | "primaryMuscles">;

/** The rest preset: the same rule as the rest itself (lib/workout `restSeconds`): 3:00 heavy legs, 2:00 other compounds, else 1:30. */
export type RestDialId = "rest.heavy" | "rest.compound" | "rest.isolation";
export function restDial(item: RestItem | null | undefined): RestDialId {
  const seconds = item ? restSeconds(item) : 90;
  return seconds >= 180 ? "rest.heavy" : seconds >= 120 ? "rest.compound" : "rest.isolation";
}

/** What the rest wheel says under its title. */
export const REST_HINTS: Record<RestDialId, string> = {
  "rest.heavy": "Heavy leg lift: starts at 3:00",
  "rest.compound": "Big lift: starts at 2:00",
  "rest.isolation": "Starts at 1:30",
};

/** The preset for one field of a set. */
export function fieldDial(field: SetField, equipment: string | null | undefined): DialId {
  switch (field) {
    case "kg": return loadDial(equipment);
    case "reps": return "set.reps";
    case "rir": return "set.rir";
    case "seconds": return "set.seconds";
    case "metres": return "set.metres";
  }
}

/** A weigh-in's or a goal's wheel, in the unit the person shows weights in. */
export function weightDial(kind: "weight" | "goal", unit: "kg" | "lb"): DialId {
  if (kind === "weight") return unit === "lb" ? "body.weight.lb" : "body.weight";
  return unit === "lb" ? "body.goal.lb" : "body.goal";
}
