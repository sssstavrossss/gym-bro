// Progress → Strength: the words and the small line for each lift's estimated max (docs/training.md, phase 4).
import { dayMonth } from "./dates";

export interface StrengthPoint {
  date: string;
  estimatedMax: number;
  kg: number;
  reps: number;
}

export interface LiftProgress {
  exerciseId: string;
  current: number;
  best: number;
  /** Last day minus the first; null with one day. */
  change: number | null;
  points: StrengthPoint[];
}

const half = (kg: number) => Math.round(kg * 2) / 2;

/** "+6 kg since 15 Nov", "−3.5 kg since 2 Nov", "No change since 2 Nov", "Once in this range". */
export function changeLine(lift: Pick<LiftProgress, "change" | "points">): string {
  if (lift.change == null || lift.points.length < 2) return "Once in this range";
  const since = dayMonth(lift.points[0].date);
  const change = half(lift.change);
  if (change === 0) return `No change since ${since}`;
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} kg since ${since}`;
}

/** How many lifts went up, of those done on two days or more. */
export function liftsUp(lifts: readonly Pick<LiftProgress, "change">[]): { up: number; of: number } {
  const moved = lifts.filter((lift) => lift.change != null);
  return { up: moved.filter((lift) => half(lift.change!) > 0).length, of: moved.length };
}

/**
 * A small line through a lift's points, oldest on the left, spaced evenly (one per day it was done), with a
 * 3-unit margin so the end dot isn't clipped. A flat or single-point line sits in the middle.
 */
export function sparkline(points: readonly Pick<StrengthPoint, "estimatedMax">[], width: number, height: number): { d: string; x: number; y: number } | null {
  if (!points.length) return null;
  const pad = 3;
  const values = points.map((point) => point.estimatedMax);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const xAt = (index: number) => (points.length === 1 ? width - pad : pad + (index * (width - 2 * pad)) / (points.length - 1));
  const yAt = (value: number) => (high === low ? height / 2 : pad + ((high - value) * (height - 2 * pad)) / (high - low));
  const coords = values.map((value, index) => [Math.round(xAt(index) * 10) / 10, Math.round(yAt(value) * 10) / 10]);
  const d = coords.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
  const [x, y] = coords[coords.length - 1];
  return { d, x, y };
}
