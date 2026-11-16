import { describe, expect, it } from "vitest";
import { MICRO_KEYS, microCoverage } from "../src/lib/nutrients";

function withKnown(count: number): Record<string, number | null> {
  return Object.fromEntries(MICRO_KEYS.map((key, index) => [key, index < count ? 1 : null]));
}

describe("microCoverage", () => {
  it("counts the 29 panel nutrients beyond the label basics", () => {
    expect(MICRO_KEYS).toHaveLength(29);
    for (const basic of ["fat", "saturatedFat", "sugars", "fiber"]) expect(MICRO_KEYS).not.toContain(basic);
    expect(MICRO_KEYS).toContain("sodium");
    expect(MICRO_KEYS).toContain("vitaminD");
  });

  it("is null when the row carries no panel", () => {
    expect(microCoverage(undefined)).toBeNull();
    expect(microCoverage(null)).toBeNull();
  });

  it("splits into none, few, some, many, and all", () => {
    const level = (known: number) => microCoverage(withKnown(known))?.level;
    expect(level(0)).toBe(0);
    expect(level(1)).toBe(1);
    expect(level(9)).toBe(1);
    expect(level(10)).toBe(2);
    expect(level(19)).toBe(2);
    expect(level(20)).toBe(3);
    expect(level(28)).toBe(3);
    expect(level(29)).toBe(4);
  });

  it("counts a zero as known and ignores keys outside the panel", () => {
    expect(microCoverage({ vitaminC: 0, iron: 0.4, fat: 12, sugars: 3 })).toEqual({ level: 1, known: 2, total: 29 });
    expect(microCoverage({})).toEqual({ level: 0, known: 0, total: 29 });
  });
});
