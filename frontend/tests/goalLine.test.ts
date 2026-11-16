import { describe, expect, it } from "vitest";
import { goalLine, roughDate } from "../src/lib/goalLine";

describe("goal line", () => {
  it("counts the weeks at the chosen rate and names a rough date", () => {
    expect(goalLine({ goal: "lose", weightKg: 82.4, goalKg: 75, rateKg: 0.5, today: "2026-11-16" }))
      .toEqual({ kind: "way", fromKg: 82.4, toKg: 75, leftKg: expect.closeTo(7.4, 5), weeks: 15, by: "early Mar 2027" });
    const gain = goalLine({ goal: "gain", weightKg: 70, goalKg: 72, rateKg: 0.25, today: "2026-01-05" });
    expect(gain).toMatchObject({ kind: "way", weeks: 8, by: "early Mar" });
  });

  it("says reached once at or past the goal", () => {
    expect(goalLine({ goal: "lose", weightKg: 75.04, goalKg: 75, rateKg: 0.5, today: "2026-11-16" })).toEqual({ kind: "reached" });
    expect(goalLine({ goal: "lose", weightKg: 74, goalKg: 75, rateKg: 0.5, today: "2026-11-16" })).toEqual({ kind: "reached" });
    expect(goalLine({ goal: "gain", weightKg: 80, goalKg: 78, rateKg: 0.5, today: "2026-11-16" })).toEqual({ kind: "reached" });
  });

  it("has nothing to say on maintain or without a weight or rate", () => {
    expect(goalLine({ goal: "maintain", weightKg: 80, goalKg: 75, rateKg: null, today: "2026-11-16" })).toBeNull();
    expect(goalLine({ goal: "lose", weightKg: null, goalKg: 75, rateKg: 0.5, today: "2026-11-16" })).toBeNull();
    expect(goalLine({ goal: "lose", weightKg: 80, goalKg: 75, rateKg: null, today: "2026-11-16" })).toBeNull();
  });

  it("splits the month in thirds", () => {
    expect(roughDate("2026-02-03", "2026-01-01")).toBe("early Feb");
    expect(roughDate("2026-02-15", "2026-01-01")).toBe("mid Feb");
    expect(roughDate("2026-02-21", "2026-01-01")).toBe("late Feb");
  });
});
