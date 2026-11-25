import { describe, expect, it } from "vitest";
import { plateLine, platesFor } from "../src/lib/plates";

describe("platesFor", () => {
  it("loads the fewest plates a side, heaviest first", () => {
    expect(platesFor(100)).toEqual({ side: [25, 15], loaded: 100 });
    expect(platesFor(72.5)).toEqual({ side: [25, 1.25], loaded: 72.5 });
    expect(platesFor(140)).toEqual({ side: [25, 25, 10], loaded: 140 });
    expect(platesFor(180)).toEqual({ side: [25, 25, 25, 5], loaded: 180 });
    expect(platesFor(47.5)).toEqual({ side: [10, 2.5, 1.25], loaded: 47.5 });
  });

  it("takes the nearest weight under one the plates can't make", () => {
    expect(platesFor(101)).toEqual({ side: [25, 15], loaded: 100 });
    expect(platesFor(23)).toEqual({ side: [1.25], loaded: 22.5 });
  });

  it("is the bar alone at or under its weight, and nothing with no weight", () => {
    expect(platesFor(20)).toEqual({ side: [], loaded: 20 });
    expect(platesFor(15)).toEqual({ side: [], loaded: 20 });
    expect(platesFor(null)).toBeNull();
    expect(platesFor(0)).toBeNull();
  });
});

describe("plateLine", () => {
  it("says the plates a side", () => {
    expect(plateLine(100)).toBe("Plates for 100 kg: 25 + 15 a side");
    expect(plateLine(52.5)).toBe("Plates for 52.5 kg: 15 + 1.25 a side");
  });

  it("gives what the plates make when they can't make the weight", () => {
    expect(plateLine(101)).toBe("Plates for 101 kg: 25 + 15 a side (100 kg)");
  });

  it("handles the bar alone, under it, and no weight", () => {
    expect(plateLine(20)).toBe("Plates for 20 kg: just the bar");
    expect(plateLine(15)).toBe("Plates for 15 kg: under the 20 kg bar");
    expect(plateLine(null)).toBe("Plates show for the weight you type");
  });
});
