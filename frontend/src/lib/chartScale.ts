/** Half-kilogram ticks until the visible axis spans more than 3 kg, then whole kilograms. */
export function axisStepKg(low: number, high: number): number {
  const range = Math.round((high - low) * 100) / 100;
  return range > 3 ? 1 : 0.5;
}

export function axisBounds(values: number[]): { lo: number; hi: number } {
  const source = values.length ? values : [80];
  const lo = Math.floor((Math.min(...source) - 0.15) * 2) / 2;
  const hi = Math.ceil((Math.max(...source) + 0.15) * 2) / 2;
  return { lo, hi: hi - lo < 1e-9 ? lo + 1 : hi };
}

/** Interior grid marks, top to bottom, one decimal. */
export function axisMarks(low: number, high: number): number[] {
  const step = axisStepKg(low, high);
  const marks: number[] = [];
  for (let mark = high - step; mark > low + 1e-9; mark -= step) {
    marks.push(Math.round(mark * 10) / 10);
  }
  return marks;
}
