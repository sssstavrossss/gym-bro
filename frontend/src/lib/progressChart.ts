import { axisBounds, axisMarks } from "./chartScale";

export interface IntakeDay {
  date: string;
  logged: boolean;
  value: number | null;
  target: number | null;
}

export interface Mark {
  x: number;
  y: number;
  h: number;
}

const pad = 8;

/** Even slots across the range, including days with nothing recorded. */
export function slotX(index: number, count: number, width: number): number {
  if (count <= 1) return width / 2;
  return pad + (index * (width - pad * 2)) / (count - 1);
}

export function valueY(value: number, low: number, high: number, height: number): number {
  const span = high - low || 1;
  return pad + ((high - value) / span) * (height - pad * 2);
}

/** Top, middle, and bottom of a scale. Duplicates collapse when the range is flat. */
export function scaleTicks(low: number, high: number): number[] {
  const ticks = [high, (low + high) / 2, low];
  return ticks.filter((tick, index) => ticks.findIndex((item) => Math.abs(item - tick) < 1e-9) === index);
}

/** At most four labels. A narrow kilogram scale keeps every half-kilogram tick. */
export function fewMarks(low: number, high: number, flat = false): number[] {
  const all = [high, ...axisMarks(low, high, flat), low].filter((tick, index, list) => (
    list.findIndex((item) => Math.abs(item - tick) < 1e-9) === index
  ));
  if (all.length <= 4) return all;
  const last = all.length - 1;
  return [0, 1, 2, 3].map((step) => all[Math.round((step * last) / 3)])
    .filter((tick, index, list) => list.indexOf(tick) === index);
}

export function intakeMax(days: IntakeDay[]): number {
  const values = days.flatMap((day) => (day.logged && day.value != null ? [day.value] : []));
  const targets = days.flatMap((day) => (day.target != null ? [day.target] : []));
  return Math.max(1, ...values, ...targets);
}

/** Logged days only. A missing day keeps its slot empty so neighbours do not slide together. */
export function intakeBars(days: IntakeDay[], width: number, height: number): Mark[] {
  const values = days.flatMap((day) => (day.logged && day.value != null ? [day.value] : []));
  const targets = days.flatMap((day) => (day.target != null ? [day.target] : []));
  const max = Math.max(1, ...values, ...targets);
  return days.flatMap((day, index) => {
    if (!day.logged || day.value == null) return [];
    const y = valueY(day.value, 0, max, height);
    const base = valueY(0, 0, max, height);
    return [{ x: slotX(index, days.length, width), y, h: Math.max(day.value === 0 ? 0 : 1, base - y) }];
  });
}

/** Target marks only where a target was saved. The line is not drawn through a day before the first target. */
export function targetLine(days: IntakeDay[], width: number, height: number): string {
  const values = days.flatMap((day) => (day.logged && day.value != null ? [day.value] : []));
  const targets = days.flatMap((day) => (day.target != null ? [day.target] : []));
  if (!targets.length) return "";
  const max = Math.max(1, ...values, ...targets);
  let pen = false;
  return days.map((day, index) => {
    if (day.target == null) {
      pen = false;
      return "";
    }
    const command = `${pen ? "L" : "M"}${slotX(index, days.length, width).toFixed(1)},${valueY(day.target, 0, max, height).toFixed(1)}`;
    pen = true;
    return command;
  }).join(" ");
}

export interface WeightDot {
  x: number;
  y: number;
  date: string;
  kg: number;
}

/** Trend is the line. Dots are logged weigh-ins only, on the same scale. */
export function weightTrend(
  days: { date: string; trendKg?: number | null }[],
  weighIns: { date: string; kg: number }[],
  width: number,
  height: number,
): { dots: WeightDot[]; line: string; low: number; high: number; flat: boolean } {
  const byDate = new Map(weighIns.map((row) => [row.date, row.kg]));
  const values = [
    ...weighIns.map((row) => row.kg),
    ...days.flatMap((day) => (day.trendKg != null ? [day.trendKg] : [])),
  ];
  const bounds = values.length ? axisBounds(values) : { lo: 0, hi: 1, flat: true };
  const { lo, hi, flat } = bounds;
  const dots: WeightDot[] = [];
  days.forEach((day, index) => {
    const kg = byDate.get(day.date);
    if (kg == null) return;
    dots.push({ x: slotX(index, days.length, width), y: valueY(kg, lo, hi, height), date: day.date, kg });
  });
  let pen = false;
  const line = days.map((day, index) => {
    if (day.trendKg == null) {
      pen = false;
      return "";
    }
    const command = `${pen ? "L" : "M"}${slotX(index, days.length, width).toFixed(1)},${valueY(day.trendKg, lo, hi, height).toFixed(1)}`;
    pen = true;
    return command;
  }).join(" ");
  return { dots, line, low: lo, high: hi, flat };
}

/** @deprecated Use weightTrend. Kept so older chart tests can still describe weigh-in dots. */
export function weightDots(
  days: { date: string }[],
  weighIns: { date: string; kg: number }[],
  width: number,
  height: number,
): { dots: WeightDot[]; line: string; low: number; high: number; flat: boolean } {
  const byDate = new Map(weighIns.map((row) => [row.date, row.kg]));
  const values = weighIns.map((row) => row.kg);
  const bounds = values.length ? axisBounds(values) : { lo: 0, hi: 1, flat: true };
  const { lo, hi, flat } = bounds;
  const dots: WeightDot[] = [];
  days.forEach((day, index) => {
    const kg = byDate.get(day.date);
    if (kg == null) return;
    dots.push({ x: slotX(index, days.length, width), y: valueY(kg, lo, hi, height), date: day.date, kg });
  });
  const line = dots.map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(" ");
  return { dots, line, low: lo, high: hi, flat };
}
