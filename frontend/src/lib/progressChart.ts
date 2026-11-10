import { axisBounds } from "./chartScale";

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

/** Dots only on days that have a weigh-in. The path joins those dots and nothing else. */
export function weightDots(
  days: { date: string }[],
  weighIns: { date: string; kg: number }[],
  width: number,
  height: number,
): { dots: WeightDot[]; line: string; low: number; high: number } {
  const byDate = new Map(weighIns.map((row) => [row.date, row.kg]));
  const values = weighIns.map((row) => row.kg);
  const bounds = values.length ? axisBounds(values) : { lo: 0, hi: 1 };
  const { lo, hi } = bounds;
  const dots: WeightDot[] = [];
  days.forEach((day, index) => {
    const kg = byDate.get(day.date);
    if (kg == null) return;
    dots.push({ x: slotX(index, days.length, width), y: valueY(kg, lo, hi, height), date: day.date, kg });
  });
  const line = dots.map((dot, index) => `${index === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(" ");
  return { dots, line, low: lo, high: hi };
}
