import { describe, expect, it } from "vitest";
import { burnRuns, burnScale, burnShapes, lastBurn, measuredDays, stepPath, type BurnSample } from "../src/lib/burnChart";

const formula = (burn = 2430, bmr = 1766): BurnSample => ({ burn, bmr, sd: 350, measured: false });
const none: BurnSample = { burn: null, bmr: null, sd: null, measured: false };

describe("burnScale", () => {
  it("rounds out from the BMR to the burn in 500s, leaving the spread out", () => {
    expect(burnScale([formula(), { burn: 2806, bmr: 1766, sd: 244, measured: true }])).toEqual({ lo: 1500, hi: 3000, ticks: [1500, 2000, 2500, 3000] });
  });

  it("uses 250s over a short span and 1,000s over a wide one", () => {
    expect(burnScale([formula(1900, 1600)])?.ticks).toEqual([1250, 1500, 1750, 2000, 2250]);
    expect(burnScale([formula(4200, 1500)])?.ticks).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it("has no scale without a burn", () => {
    expect(burnScale([none, none])).toBeNull();
  });
});

describe("burnRuns", () => {
  it("breaks the line on a day without a target", () => {
    expect(burnRuns([none, formula(), formula(), none, formula()])).toEqual([[1, 2], [4, 4]]);
  });
});

describe("stepPath", () => {
  const y = (value: number) => value;

  it("is flat across a run of one value, edge to edge", () => {
    const path = stepPath([100, 100, 100], 2, 10, y);
    expect(path.forward).toBe("M20,100 L50,100");
    expect(path.back).toBe(" L50,100 L20,100 Z");
  });

  it("bends through an S-curve at a change, up to 8px each side", () => {
    expect(stepPath([100, 100, 100, 200, 200, 200], 0, 10, y).forward).toBe("M0,100 L22,100 C30,100 30,200 38,200 L60,200");
  });

  it("never bends past halfway to the next change", () => {
    expect(stepPath([100, 200, 300], 0, 6, y).forward).toBe("M0,100 L3,100 C6,100 6,200 9,200 L9,200 C12,200 12,300 15,300 L18,300");
  });

  it("goes back over the same points to close an area", () => {
    expect(stepPath([100, 200], 0, 20, y).back).toBe(" L40,200 L28,200 C20,200 20,100 12,100 L0,100 Z");
  });
});

describe("burnShapes", () => {
  it("draws each run on its own and closes the areas", () => {
    const shapes = burnShapes([formula(2000, 1500), none, formula(2000, 1500)], 10, (value) => value / 10, 200);
    expect(shapes.burn).toBe("M0,200 L10,200 M20,200 L30,200");
    expect(shapes.activity).toBe("M0,200 L10,200 L10,150 L0,150 Z M20,200 L30,200 L30,150 L20,150 Z");
    expect(shapes.spread).toBe("M0,235 L10,235 L10,165 L0,165 Z M20,235 L30,235 L30,165 L20,165 Z");
    expect(shapes.base).toBe("M0,150 L10,150 L10,200 L0,200 Z M20,150 L30,150 L30,200 L20,200 Z");
  });

  it("is empty without a burn", () => {
    expect(burnShapes([none], 10, (value) => value, 100)).toEqual({ burn: "", bmr: "", activity: "", spread: "", base: "" });
  });
});

describe("measuredDays", () => {
  it("marks where a measurement narrowed the spread, not the drift after it", () => {
    const samples: BurnSample[] = [formula(), formula(), { burn: 2806, bmr: 1766, sd: 244, measured: true }, { burn: 2806, bmr: 1766, sd: 245, measured: true }];
    expect(measuredDays(samples)).toEqual([2]);
  });

  it("doesn't mark the window's first day", () => {
    expect(measuredDays([{ burn: 2806, bmr: 1766, sd: 244, measured: true }])).toEqual([]);
  });
});

describe("lastBurn", () => {
  it("is the last day with a burn", () => {
    expect(lastBurn([formula(2400), formula(2500), none])).toEqual({ index: 1, burn: 2500, bmr: 1766 });
    expect(lastBurn([none])).toBeNull();
  });
});
