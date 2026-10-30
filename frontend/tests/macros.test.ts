import { describe, expect, it } from "vitest";
import { kcalFromMacros, macroStatus } from "../src/lib/macros";

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

describe("quick add 4/9/4", () => {
  it("works kcal out from protein, fat and carbs", () => {
    expect(kcalFromMacros(10, 10, 10)).toBe(170);
    expect(kcalFromMacros(0, 0, 0)).toBe(0);
  });
});
