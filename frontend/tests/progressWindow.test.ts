import { describe, expect, it } from "vitest";
import {
  boxOf, centreOf, clampOffset, dayIndexAt, lineStrip, maxOffset, monthStarts, offsetAtStripDay, offsetForCentre, patchIntake, patchWindows, rateAt,
  stripSpan, weekBarStrip, weightWindow, windowLength, windowOf,
} from "../src/lib/progressWindow";
import { addDays } from "../src/lib/dates";

const TODAY = "2026-11-27";
const dates = (count: number) => Array.from({ length: count }, (_, i) => addDays(TODAY, i - count + 1));

describe("progress window", () => {
  it("fits a range longer than the history to it, like All", () => {
    expect(windowLength("30d", 400)).toBe(30);
    expect(windowLength("6m", 400)).toBe(182);
    expect(windowLength("90d", 21)).toBe(21);
    expect(windowLength("all", 400)).toBe(400);
    expect(windowLength("7d", 0)).toBe(1);
  });

  it("spans the history on the strip, a year at most for the fixed ranges", () => {
    expect(stripSpan("7d", 30)).toBe(30);
    expect(stripSpan("7d", 900)).toBe(365);
    expect(stripSpan("6m", 900)).toBe(365);
    expect(stripSpan("all", 900)).toBe(900);
    expect(stripSpan("90d", 21)).toBe(21);
  });

  it("moves the window back within the strip only", () => {
    expect(maxOffset(365, 30)).toBe(335);
    expect(maxOffset(21, 21)).toBe(0);
    expect(clampOffset(-3, 365, 30)).toBe(0);
    expect(clampOffset(400, 365, 30)).toBe(335);
    expect(clampOffset(4.6, 365, 30)).toBe(5);
    const list = dates(10);
    expect(windowOf(list, 3, 0)).toEqual(list.slice(7));
    expect(windowOf(list, 3, 2)).toEqual(list.slice(5, 8));
    expect(windowOf(list, 3, 7)).toEqual(list.slice(0, 3));
  });

  it("boxes the window on the strip, and fills it when there is nothing to move", () => {
    expect(boxOf(100, 10, 0)).toEqual({ left: 90, width: 10 });
    expect(boxOf(100, 10, 90)).toEqual({ left: 0, width: 10 });
    expect(boxOf(21, 21, 0)).toEqual({ left: 0, width: 100 });
    expect(boxOf(21, 30, 0)).toEqual({ left: 0, width: 100 });
  });

  it("keeps the middle of the window across a range change, and now stays now", () => {
    expect(centreOf(0, 30)).toBeNull();
    expect(offsetForCentre(null, 365, 7)).toBe(0);
    // 30 days ending 40 days ago: its middle is 54.5 days back. 7 days around it end 51.5 → 52 days back.
    const centre = centreOf(40, 30);
    expect(centre).toBe(54.5);
    expect(offsetForCentre(centre, 365, 7)).toBe(52);
    // the card keeps that middle (not the rounded window's), so going back lands where it was
    expect(offsetForCentre(centre, 365, 30)).toBe(40);
    // a longer range that can't centre there stops at the strip's start
    expect(offsetForCentre(300, 365, 182)).toBe(183);
  });

  it("puts the window's middle on a day of the strip", () => {
    expect(offsetAtStripDay(50, 100, 10)).toBe(45);
    expect(offsetAtStripDay(99, 100, 10)).toBe(0);
    expect(offsetAtStripDay(0, 100, 10)).toBe(90);
  });

  it("finds the day under the finger", () => {
    expect(dayIndexAt(0, 300, 7)).toBe(0);
    expect(dayIndexAt(299, 300, 7)).toBe(6);
    expect(dayIndexAt(400, 300, 7)).toBe(6);
    expect(dayIndexAt(-5, 300, 7)).toBe(0);
    expect(dayIndexAt(150, 300, 30)).toBe(15);
  });

  it("marks month starts", () => {
    expect(monthStarts(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])).toEqual([2]);
    expect(monthStarts(["2026-11-01", "2026-11-02"])).toEqual([]);
  });

  it("draws the trend in its band, broken where there is none", () => {
    const shape = lineStrip(dates(6), [
      { value: null, spread: null },
      { value: 84, spread: 0.4 },
      { value: 84.2, spread: 0.4 },
      { value: null, spread: null },
      { value: 83.8, spread: 0.3 },
      { value: 83.6, spread: 0.3 },
    ]);
    expect(shape.line.match(/M/g)).toHaveLength(2);
    expect(shape.line.startsWith("M1.5,")).toBe(true);
    expect(shape.band.match(/Z/g)).toHaveLength(2);
    expect(shape.bars).toEqual([]);
    for (const n of shape.line.match(/[\d.]+/g)!.map(Number)) expect(n).toBeLessThanOrEqual(36);
    expect(lineStrip(dates(2), [{ value: null, spread: null }, { value: null, spread: null }]).line).toBe("");
  });

  it("draws a bar a week ending today, fainter off its line", () => {
    const list = dates(17).map((date, i) => ({ date, logged: i !== 16, value: i === 16 ? null : i < 10 ? 2000 : 3000, target: 2000 }));
    const shape = weekBarStrip(list, "target");
    // weeks: days 10–16 (3000 avg, off), 3–9 (2000, on), 0–2 (2000, on)
    expect(shape.bars.map((bar) => [bar.x, bar.w, bar.off])).toEqual([[1, 1, false], [4, 5, false], [11, 5, true]]);
    expect(shape.bars[2].h).toBeGreaterThan(shape.bars[1].h);
    expect(shape.target.match(/M/g)).toHaveLength(3);
    // a two-day stub at the start is too thin to draw
    expect(weekBarStrip(list.slice(1), "target").bars).toHaveLength(2);
    // a limit is met under it
    expect(weekBarStrip(list, "limit").bars.every((bar) => !bar.off || bar.x === 11)).toBe(true);
  });
});

describe("weight in a window", () => {
  // A weigh-in every other day for 30 days, the trend falling 0.05 kg a day.
  const series = dates(30).map((date, i) => ({ date, trendKg: Number((86 - i * 0.05).toFixed(2)), trendBandKg: 0.3 }));
  const weighIns = series.filter((_, i) => i % 2 === 0).map((day) => ({ date: day.date, kg: day.trendKg + 0.2 }));
  const trendOn = (date: string) => series.find((day) => day.date === date)?.trendKg;

  it("works out the rate as the server does: 14 days up to the last weigh-in, per week", () => {
    // last weigh-in is day 28 (two days ago); 14 days before it, 0.7 kg higher → −0.35 kg a week.
    expect(rateAt(weighIns, trendOn, TODAY)).toBe(-0.35);
    // up to day 13 there are 7 weigh-ins but the run started only 12 days before the last one
    expect(rateAt(weighIns, trendOn, series[13].date)).toBeNull();
    expect(rateAt(weighIns, trendOn, series[14].date)).toBe(-0.35);
    expect(rateAt([], trendOn, TODAY)).toBeNull();
  });

  it("needs four weigh-ins since the last fresh start", () => {
    const sparse = [
      { date: addDays(TODAY, -80), kg: 90 },
      { date: addDays(TODAY, -60), kg: 90 },
      // a 30-day gap: a fresh start
      { date: addDays(TODAY, -20), kg: 86 },
      { date: addDays(TODAY, -10), kg: 86 },
      { date: addDays(TODAY, -3), kg: 86 },
      { date: TODAY, kg: 86 },
    ];
    const flat = () => 86;
    expect(rateAt(sparse, flat, TODAY)).toBe(0);
    expect(rateAt(sparse, flat, addDays(TODAY, -1))).toBeNull();
  });

  it("rounds half a hundredth away from zero", () => {
    const four = [0, 5, 10, 14].map((back) => ({ date: addDays(TODAY, -back), kg: 80 }));
    expect(rateAt(four, (date) => (date === TODAY ? 80.01 : 80), TODAY)).toBe(0.01);
    expect(rateAt(four, (date) => (date === TODAY ? 79.99 : 80), TODAY)).toBe(-0.01);
    expect(rateAt(four, (date) => (date === TODAY ? 79.67 : 80), TODAY)).toBe(-0.17);
  });

  it("reads trend, latest, count and rate off the window's end", () => {
    const now = weightWindow(series, weighIns, series[23].date, TODAY);
    expect(now).toEqual({ trendKg: 84.55, bandKg: 0.3, latestKg: weighIns[weighIns.length - 1].kg, count: 3, rateKgPerWeek: -0.35 });
    const earlier = weightWindow(series, weighIns, series[3].date, series[9].date);
    expect(earlier.trendKg).toBe(85.55);
    expect(earlier.latestKg).toBe(weighIns[4].kg);
    expect(earlier.count).toBe(3);
    expect(earlier.rateKgPerWeek).toBeNull();
    expect(weightWindow(series, [], series[0].date, TODAY)).toMatchObject({ latestKg: null, count: 0, rateKgPerWeek: null });
  });
});

describe("patching after a log change", () => {
  it("covers the touched days with as few 7-day windows as it can", () => {
    expect(patchWindows([TODAY], TODAY)).toEqual([null]);
    expect(patchWindows([addDays(TODAY, -6), TODAY], TODAY)).toEqual([null]);
    expect(patchWindows([addDays(TODAY, -7)], TODAY)).toEqual([addDays(TODAY, -7)]);
    // 30 and 26 days ago share a window ending 26 days ago
    expect(patchWindows([addDays(TODAY, -30), addDays(TODAY, -26), TODAY], TODAY)).toEqual([null, addDays(TODAY, -26)]);
    expect(patchWindows([], TODAY)).toEqual([]);
  });

  it("gives up for many windows, or a day after today", () => {
    expect(patchWindows([-10, -20, -30, -40].map((n) => addDays(TODAY, n)), TODAY)).toBeNull();
    expect(patchWindows([-10, -20, -30].map((n) => addDays(TODAY, n)), TODAY)).toHaveLength(3);
    expect(patchWindows([addDays(TODAY, 1)], TODAY)).toBeNull();
  });

  it("puts in the fresh intake and keeps the rest of each day", () => {
    type Day = { date: string; logged: boolean; kcal: number | null; protein: number | null; trendKg: number; targetKcal: number };
    const days: Day[] = [
      { date: "2026-11-26", logged: true, kcal: 1800, protein: 120, trendKg: 84.1, targetKcal: 2200 },
      { date: "2026-11-27", logged: true, kcal: 400, protein: 20, trendKg: 84.0, targetKcal: 2200 },
    ];
    const fresh: Day[] = [
      { date: "2026-11-27", logged: true, kcal: 950, protein: 60, trendKg: 99, targetKcal: 1 },
      { date: "2026-11-25", logged: false, kcal: null, protein: null, trendKg: 99, targetKcal: 1 },
    ];
    const next = patchIntake(days, fresh);
    expect(next[0]).toBe(days[0]);
    expect(next[1]).toMatchObject({ kcal: 950, protein: 60, trendKg: 84.0, targetKcal: 2200, fat: null });
    expect(next).toHaveLength(2);
    // a day whose food was all deleted
    expect(patchIntake(days, [{ date: "2026-11-26", logged: false, kcal: null, protein: null, trendKg: 1, targetKcal: 1 }])[0]).toMatchObject({ logged: false, kcal: null, trendKg: 84.1 });
  });
});
