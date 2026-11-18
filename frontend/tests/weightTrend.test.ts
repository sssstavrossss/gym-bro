import { describe, expect, it } from "vitest";
import { rateStat, trendExtent, trendShapes, type TrendSample } from "../src/lib/weightTrend";

const x = (i: number) => i * 10;
const y = (v: number) => 100 - v;

function day(trend: number | null, band: number | null = 1, measured = true): TrendSample {
  return { trend, band, measured };
}

describe("trendShapes", () => {
  it("draws measured days solid and the rest dashed", () => {
    const shapes = trendShapes([day(80), day(80), day(81, 1, false), day(81, 1, false)], x, y);
    expect(shapes.solid).toBe("M0.0 20.0 L10.0 20.0");
    // The step into an unmeasured day is dashed, so the dashed stretch starts at the last measured day.
    expect(shapes.dashed).toBe("M10.0 20.0 L20.0 19.0 L30.0 19.0");
  });

  it("goes back to solid after a gap", () => {
    const shapes = trendShapes([day(80), day(80, 1, false), day(80)], x, y);
    expect(shapes.solid).toBe("");
    expect(shapes.dashed).toBe("M0.0 20.0 L10.0 20.0 L20.0 20.0");
    const back = trendShapes([day(80), day(80, 1, false), day(80), day(80)], x, y);
    expect(back.solid).toBe("M20.0 20.0 L30.0 20.0");
  });

  it("draws the inner band at ±1 and the outer at ±2", () => {
    const shapes = trendShapes([day(80, 0.5), day(80, 1)], x, y);
    expect(shapes.inner).toBe("M0.0 19.5 L10.0 19.0 L10.0 21.0 L0.0 20.5 Z");
    expect(shapes.outer).toBe("M0.0 19.0 L10.0 18.0 L10.0 22.0 L0.0 21.0 Z");
  });

  it("breaks the line and the bands at a fresh-start gap", () => {
    const shapes = trendShapes([day(80), day(80), day(null, null, false), day(70), day(70)], x, y);
    expect(shapes.solid).toBe("M0.0 20.0 L10.0 20.0 M30.0 30.0 L40.0 30.0");
    expect(shapes.inner.match(/Z/g)).toHaveLength(2);
  });

  it("draws nothing for a single day", () => {
    expect(trendShapes([day(null, null), day(80)], x, y)).toEqual({ inner: "", outer: "", solid: "", dashed: "" });
  });
});

describe("trendExtent", () => {
  it("fits the likely range, not the faint outer one", () => {
    expect(trendExtent([day(null), day(80, 0.5), day(81, null)])).toEqual([79.5, 80.5, 81]);
  });
});

describe("rateStat", () => {
  it("waits for two weeks of weigh-ins", () => {
    expect(rateStat(null, "kg")).toEqual({ value: "–", sub: "needs 2 weeks" });
  });

  it("names the direction, and calls a rounded zero steady", () => {
    expect(rateStat(-0.36, "kg")).toEqual({ value: "−0.4 kg/wk", sub: "losing" });
    expect(rateStat(0.25, "kg")).toEqual({ value: "+0.3 kg/wk", sub: "gaining" });
    expect(rateStat(-0.04, "kg")).toEqual({ value: "0.0 kg/wk", sub: "steady" });
  });

  it("follows the shown unit", () => {
    expect(rateStat(-0.5, "lb")).toEqual({ value: "−1.1 lb/wk", sub: "losing" });
  });
});
