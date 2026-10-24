/** Half-kilogram ticks until the visible axis spans more than 3 kg, then whole kilograms. */
export function axisStepKg(low: number, high: number): number {
  const range = Math.round((high - low) * 100) / 100;
  return range > 3 ? 1 : 0.5;
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A flat line (one reading, or values within 0.05 kg) is centred on that value.
 * Wider series keep the half-kilogram padding.
 */
export function axisBounds(values: number[]): { lo: number; hi: number; flat: boolean } {
  const source = values.length ? values : [80];
  const min = Math.min(...source);
  const max = Math.max(...source);
  const flat = values.length > 0 && max - min < 0.05;
  if (flat) {
    const mid = tenth((min + max) / 2);
    return { lo: tenth(mid - 1), hi: tenth(mid + 1), flat: true };
  }
  const lo = Math.floor((min - 0.15) * 2) / 2;
  const hi = Math.ceil((max + 0.15) * 2) / 2;
  return { lo, hi: hi - lo < 1e-9 ? lo + 1 : hi, flat: false };
}

/** Interior grid marks, top to bottom, one decimal. A flat scale labels the value itself. */
export function axisMarks(low: number, high: number, flat = false): number[] {
  if (flat) {
    const mid = tenth((low + high) / 2);
    return [tenth(mid + 0.5), mid, tenth(mid - 0.5)];
  }
  const step = axisStepKg(low, high);
  const marks: number[] = [];
  for (let mark = high - step; mark > low + 1e-9; mark -= step) {
    marks.push(Math.round(mark * 10) / 10);
  }
  return marks;
}
