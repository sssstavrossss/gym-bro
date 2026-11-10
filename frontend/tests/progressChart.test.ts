import { expect, it } from "vitest";
import { intakeBars, slotX, targetLine, weightDots } from "../src/lib/progressChart";

const days = [
  { date: "2026-11-08", logged: true, value: 400, target: 2000 },
  { date: "2026-11-09", logged: false, value: null, target: 2000 },
  { date: "2026-11-10", logged: true, value: 600, target: 2000 },
];

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

it("plots weigh-ins only, and joins just those dots", () => {
  const drawn = weightDots(days, [{ date: "2026-11-08", kg: 84 }, { date: "2026-11-10", kg: 83.6 }], 320, 140);
  expect(drawn.dots.map((dot) => dot.date)).toEqual(["2026-11-08", "2026-11-10"]);
  expect(drawn.line.startsWith("M")).toBe(true);
  expect(drawn.line.split("L")).toHaveLength(2);
  expect(drawn.dots[1].y).toBeGreaterThan(drawn.dots[0].y);
});
