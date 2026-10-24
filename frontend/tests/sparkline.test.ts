import { describe, expect, it } from "vitest";
import { SPARK_WIDTH, sparklineLayout } from "../src/lib/sparkline";

describe("sparkline", () => {
  it("is 132 px wide and dots only the real weigh-ins", () => {
    expect(SPARK_WIDTH).toBe(132);
    const layout = sparklineLayout([
      { weighInKg: 84, trendKg: 84 },
      { weighInKg: null, trendKg: 83.6 },
      { weighInKg: null, trendKg: 83.2 },
      { weighInKg: 82.4, trendKg: 82.8 },
    ]);
    expect(layout.dots).toHaveLength(2);
    expect(layout.dots[0].cx).toBe(6 + 3 * 20);
    expect(layout.dots[1].cx).toBe(6 + 6 * 20);
    expect(layout.line.split(" ").length).toBe(4);
    expect(layout.dots.every((dot) => dot.cx >= 0 && dot.cx <= SPARK_WIDTH)).toBe(true);
  });

  it("draws nothing when the week has no readings", () => {
    expect(sparklineLayout([{ weighInKg: null, trendKg: null }])).toEqual({ dots: [], line: "" });
  });
});
