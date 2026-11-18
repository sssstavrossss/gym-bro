import { describe, expect, it } from "vitest";
import { fatCaption, goalSheetHint, goalStats, isExact, proteinCaption, saturatedCaption, sodiumCaption, stepWhole } from "../src/lib/goalCards";
import { fatLimits } from "../src/lib/nutrientCards";

const kg = (value: number) => value.toFixed(1);

describe("macro rows", () => {
  it("captions each macro with its rate and grams", () => {
    expect(proteinCaption("2.0", 165)).toBe("2.0 g/kg · 165 g");
    expect(proteinCaption("1.8", null)).toBe("1.8 g/kg");
    expect(fatCaption("25", 62)).toBe("25% · 62 g");
    expect(fatCaption("28.5", null)).toBe("28.5%");
  });

  it("marks only a macro set by hand as exact", () => {
    expect(isExact("exact")).toBe(true);
    expect(isExact("normal")).toBe(false);
    expect(isExact("more")).toBe(false);
  });

  it("gives the saturated fat limit in grams for the target, with cholesterol on Strict", () => {
    expect(saturatedCaption(fatLimits("normal", 2225))).toBe("≤ 25 g a day");
    expect(saturatedCaption(fatLimits("lower", 2225))).toBe("≤ 17 g, cholesterol ≤ 200 mg");
    expect(saturatedCaption(fatLimits("normal", null))).toBe("≤ 10% of calories");
    expect(saturatedCaption(fatLimits("lower", null))).toBe("≤ 7% of calories, cholesterol ≤ 200 mg");
    expect(sodiumCaption(2300)).toBe("≤ 2,300 mg a day · 5.8 g salt");
    expect(sodiumCaption(1500)).toBe("≤ 1,500 mg a day · 3.8 g salt");
  });
});

describe("goal figures", () => {
  it("shows what is left, how long, and roughly when", () => {
    const line = { kind: "way" as const, fromKg: 82.4, toKg: 76, leftKg: 6.4, weeks: 13, by: "mid Feb 2027" };
    expect(goalStats(line, kg, "kg")).toEqual([
      { label: "To go", value: "6.4 kg" },
      { label: "Takes about", value: "13 weeks" },
      { label: "Reached", value: "mid Feb 2027" },
    ]);
    expect(goalStats({ ...line, weeks: 1 }, kg, "kg")[1].value).toBe("1 week");
  });

  it("explains the weight being typed on the goal weight sheet", () => {
    const line = { kind: "way" as const, fromKg: 82.4, toKg: 76, leftKg: 6.4, weeks: 13, by: "mid Feb" };
    expect(goalSheetHint(line, "82.4", "kg", kg)).toBe("6.4 kg to go · about 13 weeks (mid Feb)");
    expect(goalSheetHint({ kind: "reached" }, "82.4", "kg", kg)).toBe("You're at this weight now.");
    expect(goalSheetHint(null, "82.4", "kg", kg)).toBe("Your trend weight is 82.4 kg.");
    expect(goalSheetHint(null, null, "kg", kg)).toBe("");
  });
});

describe("goal weight steps", () => {
  it("moves a whole unit, landing on whole numbers, inside the range", () => {
    expect(stepWhole(76, 1, 30, 300)).toBe(77);
    expect(stepWhole(76, -1, 30, 300)).toBe(75);
    expect(stepWhole(75.4, 1, 30, 300)).toBe(76);
    expect(stepWhole(75.4, -1, 30, 300)).toBe(75);
    expect(stepWhole(300, 1, 30, 300)).toBe(300);
    expect(stepWhole(30, -1, 30, 300)).toBe(30);
  });
});
