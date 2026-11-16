import { describe, expect, it } from "vitest";
import { swipeAxis, swipeSpeed, swipeTurn } from "../src/lib/weekSwipe";

describe("week strip swipe", () => {
  it("turns on a long slow drag, either way", () => {
    expect(swipeTurn(60, 0.05, 342)).toBe(-1);
    expect(swipeTurn(-60, -0.05, 342)).toBe(1);
  });
  it("springs back on a short slow drag", () => {
    expect(swipeTurn(40, 0.1, 342)).toBe(0);
    expect(swipeTurn(-40, 0, 342)).toBe(0);
  });
  it("turns on a short quick flick", () => {
    expect(swipeTurn(30, 0.6, 342)).toBe(-1);
    expect(swipeTurn(-30, -0.6, 342)).toBe(1);
  });
  it("does not count a flick that is too short or going back", () => {
    expect(swipeTurn(20, 1, 342)).toBe(0);
    expect(swipeTurn(40, -0.8, 342)).toBe(0);
  });
  it("needs less on a narrow strip", () => {
    expect(swipeTurn(50, 0, 260)).toBe(-1);
  });
  it("reads speed from first and last sample", () => {
    expect(swipeSpeed([{ t: 0, x: 100 }, { t: 50, x: 90 }, { t: 100, x: 60 }])).toBeCloseTo(-0.4);
    expect(swipeSpeed([{ t: 0, x: 100 }])).toBe(0);
    expect(swipeSpeed([{ t: 5, x: 100 }, { t: 5, x: 120 }])).toBe(0);
  });
  it("waits 8px, then leans sideways", () => {
    expect(swipeAxis(5, 6)).toBe("none");
    expect(swipeAxis(10, 12)).toBe("h");
    expect(swipeAxis(10, 13)).toBe("v");
    expect(swipeAxis(0, 10)).toBe("v");
  });
});
