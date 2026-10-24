/** Phone Today sparkline. Seven days, 132 px wide, matching the prototype. */
export const SPARK_WIDTH = 132;
export const SPARK_HEIGHT = 52;

export interface SparkSample {
  weighInKg: number | null;
  trendKg: number | null;
}

export interface SparkDot {
  cx: number;
  cy: number;
}

export function sparklineLayout(samples: SparkSample[]): { dots: SparkDot[]; line: string } {
  const days: SparkSample[] = Array.from({ length: 7 }, () => ({ weighInKg: null, trendKg: null }));
  const window = samples.slice(-7);
  const offset = 7 - window.length;
  window.forEach((sample, index) => {
    days[offset + index] = sample;
  });
  const values = days.flatMap((day) => [day.weighInKg, day.trendKg]).filter((value): value is number => value != null);
  if (!values.length) return { dots: [], line: "" };
  const hi = Math.max(...values) + 0.05;
  const lo = Math.min(...values) - 0.05;
  const span = Math.max(hi - lo, 0.6);
  const y = (value: number) => Number((((hi - value) / span) * (SPARK_HEIGHT - 12) + 6).toFixed(1));
  const x = (index: number) => 6 + index * 20;
  const dots = days.flatMap((day, index) => (day.weighInKg == null ? [] : [{ cx: x(index), cy: y(day.weighInKg) }]));
  const line = days.flatMap((day, index) => (day.trendKg == null ? [] : [`${x(index)},${y(day.trendKg)}`])).join(" ");
  return { dots, line };
}
