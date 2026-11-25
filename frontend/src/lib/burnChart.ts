/**
 * The Burn page of the Home Progress card: the daily burn and BMR in effect each day.
 * Both change in steps (a recalculation, a profile edit), so each is drawn flat with a short
 * S-curve across each change. The spread around the burn widens between measurements.
 */

export interface BurnSample {
  burn: number | null;
  bmr: number | null;
  sd: number | null;
  measured: boolean;
}

export interface BurnScale {
  lo: number;
  hi: number;
  ticks: number[];
}

/** Room above the burn and below the BMR, kcal, before rounding out to a tick. */
const ROOM = 150;

/**
 * The axis from the BMR to the burn, rounded out to even ticks: every 250 kcal over a short span,
 * 500 over a usual one, 1,000 over a wide one. The spread isn't counted: a formula burn's ±350 would
 * flatten the lines, so the band is clipped to the plot instead.
 */
export function burnScale(samples: readonly BurnSample[]): BurnScale | null {
  const values = samples.flatMap((sample) => (sample.burn != null && sample.bmr != null ? [sample.burn, sample.bmr] : []));
  if (!values.length) return null;
  const low = Math.min(...values) - ROOM;
  const high = Math.max(...values) + ROOM;
  const step = high - low <= 1000 ? 250 : high - low <= 2500 ? 500 : 1000;
  const lo = Math.max(0, Math.floor(low / step) * step);
  const hi = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi; value += step) ticks.push(value);
  return { lo, hi, ticks };
}

/** Days in a row with a burn, as [first, last] indexes. A day without a target breaks the line. */
export function burnRuns(samples: readonly BurnSample[]): [number, number][] {
  const runs: [number, number][] = [];
  samples.forEach((sample, index) => {
    if (sample.burn == null || sample.bmr == null) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === index - 1) last[1] = index;
    else runs.push([index, index]);
  });
  return runs;
}

const EASE = 8;

export interface StepPath {
  /** From the left edge to the right: starts with M. */
  forward: string;
  /** The same shape from the right edge back to the left, to close an area: starts with L, ends with Z. */
  back: string;
}

const f = (value: number) => Number(value.toFixed(1));

/**
 * One run of daily values as a path across its days' slots. Flat within a value; at a change
 * the line bends through a short S-curve, at most 8px each side and never past halfway to the next change.
 */
export function stepPath(values: readonly number[], first: number, slot: number, y: (value: number) => number): StepPath {
  const left = first * slot;
  const right = (first + values.length) * slot;
  const changes: number[] = [];
  for (let k = 1; k < values.length; k += 1) if (values[k] !== values[k - 1]) changes.push(k);
  const at = (k: number) => (first + k) * slot;
  const ease = changes.map((k, i) => {
    const before = at(k) - (i ? at(changes[i - 1]) : left);
    const after = (i < changes.length - 1 ? at(changes[i + 1]) : right) - at(k);
    return Math.min(EASE, before / 2, after / 2);
  });
  const end = values[values.length - 1];
  let forward = `M${f(left)},${f(y(values[0]))}`;
  changes.forEach((k, i) => {
    const x = at(k);
    const y1 = f(y(values[k - 1]));
    const y2 = f(y(values[k]));
    forward += ` L${f(x - ease[i])},${y1} C${f(x)},${y1} ${f(x)},${y2} ${f(x + ease[i])},${y2}`;
  });
  forward += ` L${f(right)},${f(y(end))}`;
  let back = ` L${f(right)},${f(y(end))}`;
  for (let i = changes.length - 1; i >= 0; i -= 1) {
    const k = changes[i];
    const x = at(k);
    const y1 = f(y(values[k - 1]));
    const y2 = f(y(values[k]));
    back += ` L${f(x + ease[i])},${y2} C${f(x)},${y2} ${f(x)},${y1} ${f(x - ease[i])},${y1}`;
  }
  back += ` L${f(left)},${f(y(values[0]))} Z`;
  return { forward, back };
}

export interface BurnShapes {
  burn: string;
  bmr: string;
  /** Between the burn and the BMR: what moving and digesting add. */
  activity: string;
  /** The burn ± its spread. */
  spread: string;
  /** Under the BMR, down to the plot's floor. */
  base: string;
}

export function burnShapes(samples: readonly BurnSample[], slot: number, y: (value: number) => number, floor: number): BurnShapes {
  const shapes: BurnShapes = { burn: "", bmr: "", activity: "", spread: "", base: "" };
  for (const [first, last] of burnRuns(samples)) {
    const run = samples.slice(first, last + 1);
    const burn = stepPath(run.map((sample) => sample.burn!), first, slot, y);
    const bmr = stepPath(run.map((sample) => sample.bmr!), first, slot, y);
    const up = stepPath(run.map((sample) => sample.burn! + (sample.sd ?? 0)), first, slot, y);
    const down = stepPath(run.map((sample) => sample.burn! - (sample.sd ?? 0)), first, slot, y);
    const right = f((last + 1) * slot);
    const left = f(first * slot);
    shapes.burn += `${burn.forward} `;
    shapes.bmr += `${bmr.forward} `;
    shapes.activity += `${burn.forward}${bmr.back} `;
    shapes.spread += `${up.forward}${down.back} `;
    shapes.base += `${bmr.forward} L${right},${f(floor)} L${left},${f(floor)} Z `;
  }
  return {
    burn: shapes.burn.trim(),
    bmr: shapes.bmr.trim(),
    activity: shapes.activity.trim(),
    spread: shapes.spread.trim(),
    base: shapes.base.trim(),
  };
}

/** Days a burn was measured: a measured burn whose spread narrowed from the day before. */
export function measuredDays(samples: readonly BurnSample[]): number[] {
  const days: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const now = samples[i];
    const before = samples[i - 1];
    if (!now.measured || now.sd == null || before.sd == null) continue;
    if (now.sd < before.sd) days.push(i);
  }
  return days;
}

/** The last day with a burn, for the end dots and their numbers. */
export function lastBurn(samples: readonly BurnSample[]): { index: number; burn: number; bmr: number } | null {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const sample = samples[i];
    if (sample.burn != null && sample.bmr != null) return { index: i, burn: sample.burn, bmr: sample.bmr };
  }
  return null;
}
