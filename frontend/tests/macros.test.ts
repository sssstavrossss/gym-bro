import { describe, expect, it } from "vitest";
import { kcalFromMacros, macroRows, macroStatus, macroTag } from "../src/lib/macros";

describe("decision 7 macro bars", () => {
  it("treats calories within ±5% as on target and anything over as over", () => {
    expect(macroStatus("kcal", 950, 1000)).toBe("hit");
    expect(macroStatus("kcal", 1050, 1000)).toBe("hit");
    expect(macroStatus("kcal", 949, 1000)).toBe("under");
    expect(macroStatus("kcal", 1051, 1000)).toBe("over");
  });

  it("ticks protein at or above its minimum and never marks protein over", () => {
    expect(macroStatus("p", 166, 167)).toBe("under");
    expect(macroStatus("p", 167, 167)).toBe("hit");
    expect(macroStatus("p", 400, 167)).toBe("hit");
  });

  it("keeps fat and carbs inside ±10%", () => {
    expect(macroStatus("f", 90, 100)).toBe("hit");
    expect(macroStatus("f", 110, 100)).toBe("hit");
    expect(macroStatus("f", 89, 100)).toBe("under");
    expect(macroStatus("f", 111, 100)).toBe("over");
    expect(macroStatus("c", 89, 100)).toBe("under");
    expect(macroStatus("c", 100, 100)).toBe("hit");
  });
});

describe("left and over tags", () => {
  it("says what is left while under, how far over once over, and nothing on target", () => {
    expect(macroTag("kcal", 1606, 1884)).toBe("278 left");
    expect(macroTag("p", 56, 168)).toBe("112 to go");
    expect(macroTag("f", 100, 42)).toBe("+58 over");
    expect(macroTag("c", 205, 209)).toBe("");
    expect(macroTag("p", 400, 168)).toBe("");
    expect(macroTag("kcal", 900, 12000)).toBe("11,100 left");
  });
});

describe("macro rows", () => {
  const goal = { kcal: 1884, protein: 168, fat: 42, carbs: 209 };

  it("builds the four rows with status, tag, and bar length", () => {
    const rows = macroRows(goal, { kcal: 1606, p: 56, f: 100, c: 114 });
    expect(rows.map((row) => [row.label, row.status, row.tag])).toEqual([
      ["Calories", "under", "278 left"],
      ["Protein", "under", "112 to go"],
      ["Fat", "over", "+58 over"],
      ["Carbs", "under", "95 left"],
    ]);
    expect(rows[1].min).toBe(true);
    expect(rows[0].fraction).toBeCloseTo(1606 / 1884, 5);
    expect(rows.every((row) => row.added === 0 && row.adding === 0)).toBe(true);
  });

  it("marks the part of each bar a food adds", () => {
    const rows = macroRows(goal, { kcal: 1606, p: 56, f: 100, c: 114 }, { kcal: 115, p: 2.6, f: 0.6, c: 23.2 });
    expect(rows[0].adding).toBe(115);
    expect(rows[0].added).toBeCloseTo(115 / 1884, 5);
    expect(rows[3].added).toBeCloseTo(23.2 / 209, 5);
  });

  it("has no bar without a target", () => {
    expect(macroRows({ kcal: 0, protein: 0, fat: 0, carbs: 0 }, { kcal: 10, p: 1, f: 1, c: 1 }, { kcal: 10, p: 1, f: 1, c: 1 })
      .every((row) => row.fraction === 0 && row.added === 0)).toBe(true);
  });
});

describe("quick add 4/9/4", () => {
  it("works kcal out from protein, fat and carbs", () => {
    expect(kcalFromMacros(10, 10, 10)).toBe(170);
    expect(kcalFromMacros(0, 0, 0)).toBe(0);
  });
});
