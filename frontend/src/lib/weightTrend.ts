import { formatDecimal, roundHalfAwayFromZero } from "./format";
import { kgTo, type WeightUnit } from "./units";

/** One day of the trend, in the shown unit. `band` is one standard deviation; `measured` days are drawn solid. */
export interface TrendSample {
  trend: number | null;
  band: number | null;
  measured: boolean;
}

/** SVG paths for the weight chart. */
export interface TrendShapes {
  /** Likely range: trend ± 1 band. */
  inner: string;
  /** Possible range: trend ± 2 bands. Drawn faint, behind the inner one. */
  outer: string;
  /** Trend between weigh-ins at most a week apart. */
  solid: string;
  /** Trend across longer gaps and after the last weigh-in. */
  dashed: string;
}

type Point = { x: number; y: number };

/** Runs of days with a trend. A fresh-start gap (null trend) breaks the line and the bands. */
function runs(samples: TrendSample[]): number[][] {
  const out: number[][] = [];
  let run: number[] = [];
  samples.forEach((sample, index) => {
    if (sample.trend == null) {
      if (run.length) out.push(run);
      run = [];
      return;
    }
    run.push(index);
  });
  if (run.length) out.push(run);
  return out;
}

function line(points: Point[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function area(samples: TrendSample[], indexes: number[], spread: number, x: (i: number) => number, y: (v: number) => number): string {
  const live = indexes.filter((i) => samples[i].band != null);
  if (live.length < 2) return "";
  const top = live.map((i) => ({ x: x(i), y: y(samples[i].trend! + spread * samples[i].band!) }));
  const bottom = [...live].reverse().map((i) => ({ x: x(i), y: y(samples[i].trend! - spread * samples[i].band!) }));
  return `${line(top)} ${bottom.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} Z`;
}

/** Bands and the trend line, split into solid and dashed stretches. A day-to-day step is solid only when both days are measured. */
export function trendShapes(samples: TrendSample[], x: (index: number) => number, y: (value: number) => number): TrendShapes {
  const inner: string[] = [];
  const outer: string[] = [];
  const solid: string[] = [];
  const dashed: string[] = [];
  for (const run of runs(samples)) {
    inner.push(area(samples, run, 1, x, y));
    outer.push(area(samples, run, 2, x, y));
    let stretch: Point[] = [];
    let kind: boolean | null = null;
    const flush = () => {
      if (stretch.length > 1) (kind ? solid : dashed).push(line(stretch));
    };
    for (let k = 1; k < run.length; k += 1) {
      const a = run[k - 1];
      const b = run[k];
      const isSolid = samples[a].measured && samples[b].measured;
      const from = { x: x(a), y: y(samples[a].trend!) };
      const to = { x: x(b), y: y(samples[b].trend!) };
      if (isSolid !== kind) {
        flush();
        stretch = [from];
        kind = isSolid;
      }
      stretch.push(to);
    }
    flush();
  }
  const join = (parts: string[]) => parts.filter(Boolean).join(" ");
  return { inner: join(inner), outer: join(outer), solid: join(solid), dashed: join(dashed) };
}

/** Values the y axis must fit: each trend with its likely range. The faint outer range may run off the plot. */
export function trendExtent(samples: TrendSample[]): number[] {
  return samples.flatMap((s) => (s.trend == null ? [] : s.band == null ? [s.trend] : [s.trend - s.band, s.trend + s.band]));
}

/** The Rate stat: "−0.4 kg/wk" and "losing", or a dash until there are two weeks of weigh-ins. */
export function rateStat(rateKgPerWeek: number | null | undefined, unit: WeightUnit): { value: string; sub: string } {
  if (rateKgPerWeek == null) return { value: "–", sub: "needs 2 weeks" };
  const shown = roundHalfAwayFromZero(kgTo(rateKgPerWeek, unit), 1);
  if (shown === 0) return { value: `0.0 ${unit}/wk`, sub: "steady" };
  const text = formatDecimal(Math.abs(shown), 1);
  return shown < 0
    ? { value: `−${text} ${unit}/wk`, sub: "losing" }
    : { value: `+${text} ${unit}/wk`, sub: "gaining" };
}
