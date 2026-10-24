import { describe, expect, it } from "vitest";
import { axisBounds, axisMarks, axisStepKg } from "../src/lib/chartScale";

describe("chart axis", () => {
  it("uses 0.5 kg steps until the visible range is more than 3 kg", () => {
    expect(axisStepKg(80, 83)).toBe(0.5);
    expect(axisStepKg(80, 83.01)).toBe(1);
    const tight = axisBounds([83, 84]);
    expect(tight.hi - tight.lo).toBeLessThanOrEqual(3);
    expect(axisMarks(tight.lo, tight.hi).map((mark, index, marks) => index === 0 ? null : marks[index - 1] - mark).filter((step) => step != null)).toEqual([0.5, 0.5]);
  });

  it("centres a flat reading on the value itself", () => {
    const flat = axisBounds([83.6]);
    expect(flat.flat).toBe(true);
    expect((flat.lo + flat.hi) / 2).toBeCloseTo(83.6, 5);
    expect(axisMarks(flat.lo, flat.hi, flat.flat)).toEqual([84.1, 83.6, 83.1]);
    expect(axisBounds([83, 84]).flat).toBe(false);
    expect(axisBounds([83, 83.1]).flat).toBe(false);
    expect(axisBounds([83.6, 83.64]).flat).toBe(true);
    expect(axisBounds([]).flat).toBe(false);
  });

  it("uses 1 kg steps when the visible range is more than 3 kg", () => {
    const wide = axisBounds([80, 90]);
    expect(wide.hi - wide.lo).toBeGreaterThan(3);
    expect(axisStepKg(wide.lo, wide.hi)).toBe(1);
    const marks = axisMarks(wide.lo, wide.hi);
    expect(marks.length).toBeGreaterThan(2);
    for (let index = 1; index < marks.length; index += 1) {
      expect(marks[index - 1] - marks[index]).toBe(1);
    }
  });
});
