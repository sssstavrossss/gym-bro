import { expect, it } from "vitest";
import { fewMarks, intakeBars, scaleTicks, slotX, targetLine, weightTrend } from "../src/lib/progressChart";

const days = [
  { date: "2026-11-08", logged: true, value: 400, target: 2000 },
  { date: "2026-11-09", logged: false, value: null, target: 2000 },
  { date: "2026-11-10", logged: true, value: 600, target: 2000 },
];

it("labels a scale with the top, middle, and bottom", () => {
  expect(scaleTicks(0, 2000)).toEqual([2000, 1000, 0]);
  expect(scaleTicks(83, 83)).toEqual([83]);
  expect(fewMarks(70, 90).length).toBeLessThanOrEqual(4);
  expect(fewMarks(83, 84.5)).toEqual([84.5, 84, 83.5, 83]);
});

it("keeps an empty day as a gap instead of a zero bar", () => {
  const bars = intakeBars(days, 320, 140);
  expect(bars).toHaveLength(2);
  expect(bars[0].x).toBeCloseTo(slotX(0, 3, 320), 5);
  expect(bars[1].x).toBeCloseTo(slotX(2, 3, 320), 5);
  expect(bars[1].x - bars[0].x).toBeGreaterThan(100);
  expect(bars[1].h).toBeGreaterThan(bars[0].h);
});

it("does not draw a target before one was saved", () => {
  const line = targetLine([
    { date: "2026-11-08", logged: true, value: 100, target: null },
    { date: "2026-11-09", logged: false, value: null, target: 1800 },
  ], 320, 140);
  const moves = line.trim().split("M").filter(Boolean);
  expect(moves).toHaveLength(1);
});

it("draws the trend as the line and weigh-ins as dots", () => {
  const drawn = weightTrend(
    [
      { date: "2026-11-08", trendKg: 84 },
      { date: "2026-11-09", trendKg: 84 },
      { date: "2026-11-10", trendKg: 83.6 },
    ],
    [{ date: "2026-11-08", kg: 84.4 }, { date: "2026-11-10", kg: 83.2 }],
    320,
    140,
  );
  expect(drawn.dots.map((dot) => dot.date)).toEqual(["2026-11-08", "2026-11-10"]);
  expect(drawn.line.startsWith("M")).toBe(true);
  expect(drawn.line.split("L")).toHaveLength(3);
  expect(drawn.dots[1].y).toBeGreaterThan(drawn.dots[0].y);
});
