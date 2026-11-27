import { describe, expect, it } from "vitest";
import {
  arcGap, arcPlace, arcSteps, DIAL_PRESETS, dialSpec, dialText, fieldDial, indexOf, loadDial, restDial, stepText, tidy, typedValue, valueAt, wheel,
} from "../src/lib/dial";

describe("a wheel's spec", () => {
  it("takes the preset's unit, range and steps, and the screen's label and value", () => {
    const spec = dialSpec("set.kg.barbell", { label: "Set 2 · kg", hint: "20 a side", value: 100 });
    expect(spec).toMatchObject({ id: "set.kg.barbell", label: "Set 2 · kg", hint: "20 a side", unit: "kg", value: 100, min: 0, max: 500, step: 2.5, format: "num" });
    expect(spec.steps).toEqual([1.25, 2.5, 5, 10]);
  });

  it("starts at the preset's start with no value, and keeps the value in range", () => {
    expect(dialSpec("body.weight", { label: "Weight", value: null }).value).toBe(80);
    expect(dialSpec("set.rir", { label: "RIR", value: 14 }).value).toBe(10);
    expect(dialSpec("set.reps", { label: "Reps", value: 5, min: 6 }).value).toBe(6);
  });

  it("uses the step the person kept, while it is still one on offer", () => {
    expect(dialSpec("rest.compound", { label: "Rest", value: 120 }, 30).step).toBe(30);
    expect(dialSpec("rest.compound", { label: "Rest", value: 120 }, 7).step).toBe(15);
  });

  it("offers our step among its steps, smallest first, in every preset", () => {
    for (const preset of Object.values(DIAL_PRESETS)) {
      expect(preset.steps).toContain(preset.step);
      expect([...preset.steps].sort((a, b) => a - b)).toEqual([...preset.steps]);
      expect(preset.min).toBeLessThan(preset.max);
    }
  });
});

describe("the wheel's values", () => {
  it("are whole steps from the value it opened on, down to the minimum", () => {
    const w = wheel(83.65, 0.1, 30, 250);
    expect(w.first).toBe(30.05);
    expect(valueAt(w, indexOf(w, 83.65))).toBe(83.65);
    expect(valueAt(w, indexOf(w, 83.65) + 1)).toBe(83.75);
    expect(valueAt(w, w.count - 1)).toBe(249.95);
  });

  it("start at the minimum when the value is on a step from it", () => {
    const w = wheel(100, 2.5, 0, 500);
    expect(w).toEqual({ first: 0, step: 2.5, count: 201 });
    expect(indexOf(w, 100)).toBe(40);
  });

  it("stay on the ends", () => {
    const w = wheel(5, 1, 0, 10);
    expect(valueAt(w, -3)).toBe(0);
    expect(valueAt(w, 99)).toBe(10);
    expect(indexOf(w, 42)).toBe(10);
  });

  it("are free of float dust", () => {
    expect(tidy(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(valueAt(wheel(0, 0.05, 0, 1), 7)).toBe(0.35);
  });
});

describe("a number's words", () => {
  it("reads a clock as m:ss, or h:mm:ss from an hour", () => {
    expect(dialText(90, "clock", 15)).toBe("1:30");
    expect(dialText(5, "clock", 5)).toBe("0:05");
    expect(dialText(3725, "clock", 5)).toBe("1:02:05");
  });

  it("shows halves as ½", () => {
    expect(dialText(2.5, "half", 0.5)).toBe("2½");
    expect(dialText(0.5, "half", 0.5)).toBe("½");
    expect(dialText(0, "half", 0.5)).toBe("0");
    expect(dialText(3, "half", 1)).toBe("3");
  });

  it("keeps as many decimals as the finer of the step and where it started", () => {
    expect(dialText(83.6, "num", 0.1)).toBe("83.6");
    expect(dialText(83.7, "num", 0.1, 83.65)).toBe("83.70");
    expect(dialText(83.65, "num", 0.05)).toBe("83.65");
    expect(dialText(100, "num", 2.5)).toBe("100");
    expect(dialText(102.5, "num", 2.5)).toBe("102.5");
  });

  it("names a step chip", () => {
    expect(stepText(15, "clock")).toBe("15 s");
    expect(stepText(60, "clock")).toBe("1 min");
    expect(stepText(0.5, "half")).toBe("½");
    expect(stepText(2.5, "num")).toBe("2.5");
  });
});

describe("the ring", () => {
  it("puts the value at the top, the others round it, smaller and fainter", () => {
    const mid = arcPlace(0, 20);
    expect(mid.x).toBeCloseTo(0);
    expect(mid.y).toBeCloseTo(-170);
    expect(mid.scale).toBeCloseTo(1.35);
    expect(mid.opacity).toBe(1);
    const side = arcPlace(2, 20);
    expect(side.x).toBeGreaterThan(0);
    expect(side.scale).toBeLessThan(mid.scale);
    expect(side.opacity).toBeLessThan(1);
    expect(arcPlace(-2, 20).x).toBeCloseTo(-side.x);
    expect(arcPlace(5, 20).opacity).toBe(0);
  });

  it("spaces longer numbers further apart", () => {
    expect(arcGap("12")).toBeLessThan(arcGap("1:30"));
    expect(arcGap("1:30")).toBeLessThan(arcGap("83.65"));
    expect(arcGap("1:02:05")).toBe(31);
  });

  it("turns a tap beside the middle into steps", () => {
    expect(arcSteps(0, 20)).toBe(0);
    const two = arcPlace(2, 20);
    expect(arcSteps(two.x, 20)).toBe(2);
    expect(arcSteps(-two.x, 20)).toBe(-2);
  });
});

describe("typing on a keyboard", () => {
  it("reads a number", () => {
    expect(typedValue("82", "num")).toBe(82);
    expect(typedValue("82.5", "num")).toBe(82.5);
    expect(typedValue("82,5", "num")).toBe(82.5);
    expect(typedValue("82.", "num")).toBe(82);
    expect(typedValue("", "num")).toBeNull();
    expect(typedValue("a", "num")).toBeNull();
  });

  it("reads a clock's digits from the right, like the keypad", () => {
    expect(typedValue("230", "clock")).toBe(150);
    expect(typedValue("45", "clock")).toBe(45);
    expect(typedValue("10000", "clock")).toBe(3600);
    expect(typedValue("2:30", "clock")).toBeNull();
  });
});

describe("training's wheels", () => {
  it("pick the load's steps by the kit", () => {
    expect(loadDial("barbell")).toBe("set.kg.barbell");
    expect(loadDial("ez-bar")).toBe("set.kg.barbell");
    expect(loadDial("dumbbell")).toBe("set.kg.dumbbell");
    expect(loadDial("kettlebell")).toBe("set.kg.kettlebell");
    expect(loadDial("bodyweight")).toBe("set.kg.body");
    expect(loadDial("none")).toBe("set.kg.body");
    expect(loadDial("cable")).toBe("set.kg.machine");
    expect(loadDial(null)).toBe("set.kg.machine");
  });

  it("pick the rest's start and steps by the lift", () => {
    const lift = (mechanic: string, muscles: string[]) => ({ category: "strength", mechanic, measure: "weight_reps", primaryMuscles: muscles }) as never;
    expect(restDial(lift("compound", ["quadriceps", "lower-back"]))).toBe("rest.heavy");
    expect(restDial(lift("compound", ["chest"]))).toBe("rest.compound");
    expect(restDial(lift("isolation", ["biceps"]))).toBe("rest.isolation");
    expect(restDial(null)).toBe("rest.isolation");
    expect(DIAL_PRESETS["rest.heavy"].start).toBe(180);
  });

  it("pick a set field's wheel", () => {
    expect(fieldDial("kg", "dumbbell")).toBe("set.kg.dumbbell");
    expect(fieldDial("reps", "barbell")).toBe("set.reps");
    expect(fieldDial("rir", null)).toBe("set.rir");
    expect(fieldDial("seconds", null)).toBe("set.seconds");
    expect(fieldDial("metres", null)).toBe("set.metres");
  });
});
