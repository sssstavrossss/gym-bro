import { describe, expect, it } from "vitest";
import {
  cmToFtIn,
  goalText,
  heightRangeError,
  heightText,
  heightUnitOf,
  kgTo,
  parseFtIn,
  parseWeight,
  rateText,
  signedWeight,
  toKg,
  typoGuardSentence,
  weightRange,
  weightRangeError,
  weightText,
  weightUnitOf,
} from "../src/lib/units";

describe("weight units", () => {
  it("reads only the two known units", () => {
    expect(weightUnitOf("lb")).toBe("lb");
    expect(weightUnitOf("stone")).toBe("kg");
    expect(weightUnitOf(undefined)).toBe("kg");
    expect(heightUnitOf("ftin")).toBe("ftin");
    expect(heightUnitOf("in")).toBe("cm");
  });

  it("keeps a typed pound value through two kilogram decimals", () => {
    expect(toKg(180, "lb")).toBe(81.65);
    expect(weightText(81.65, "lb")).toBe("180.0");
    expect(toKg(165, "lb")).toBe(74.84);
    expect(goalText(74.84, "lb")).toBe("165");
    expect(toKg(184.3, "lb")).toBe(83.6);
    expect(weightText(83.6, "lb")).toBe("184.3");
    // Every one-decimal pound value from 66.2 to 661.3 comes back as typed.
    for (let tenths = 662; tenths <= 6613; tenths++) {
      const lb = tenths / 10;
      expect(weightText(toKg(lb, "lb"), "lb")).toBe(lb.toFixed(1));
    }
  });

  it("leaves kilograms alone", () => {
    expect(toKg(83.4, "kg")).toBe(83.4);
    expect(kgTo(83.4, "kg")).toBe(83.4);
    expect(weightText(80.05, "kg")).toBe("80.1");
    expect(goalText(80, "kg")).toBe("80");
    expect(goalText(80.05, "kg")).toBe("80.1");
    expect(goalText(80.04, "kg")).toBe("80");
  });

  it("signs a change in the shown unit", () => {
    expect(signedWeight(-0.5, "lb")).toBe("−1.1");
    expect(signedWeight(0.2, "kg")).toBe("+0.2");
    expect(signedWeight(0, "lb")).toBe("0.0");
  });

  it("parses one decimal in the shown unit, within 30 to 300 kg", () => {
    expect(parseWeight("180", "lb")).toBe(81.65);
    expect(parseWeight("180,4", "lb")).toBe(81.83);
    expect(parseWeight("180.45", "lb")).toBeNull();
    expect(parseWeight("66.1", "lb")).toBeNull();
    expect(parseWeight("66.2", "lb")).toBe(30.03);
    expect(parseWeight("661.3", "lb")).toBe(299.96);
    expect(parseWeight("661.4", "lb")).toBeNull();
    expect(parseWeight("83.4", "kg")).toBe(83.4);
    expect(parseWeight("300.1", "kg")).toBeNull();
    expect(parseWeight("abc", "kg")).toBeNull();
  });

  it("names the range in the shown unit", () => {
    expect(weightRange("kg")).toEqual({ min: "30", max: "300" });
    expect(weightRange("lb")).toEqual({ min: "66.2", max: "661.3" });
    expect(weightRangeError("Goal weight", "lb")).toBe("Goal weight should be between 66.2 and 661.3 lb, with one decimal.");
  });

  it("shows the rate chips as exact pounds", () => {
    expect([0.25, 0.5, 0.75, 1].map((rate) => rateText(rate, "lb"))).toEqual(["0.6", "1.1", "1.7", "2.2"]);
    expect([0.25, 0.5, 0.75, 1].map((rate) => rateText(rate, "kg"))).toEqual(["0.25", "0.5", "0.75", "1.0"]);
  });

  it("matches the confirm sentence for a trend of 80.05", () => {
    expect(typoGuardSentence(90, 80.05, "kg")).toBe(
      "Is 90.0 kg right? That's 10.0 kg above your trend (80.1 kg). Nothing is saved until you choose.",
    );
    expect(typoGuardSentence(90, 80, "lb")).toBe(
      "Is 198.4 lb right? That's 22.0 lb above your trend (176.4 lb). Nothing is saved until you choose.",
    );
  });
});

describe("height units", () => {
  it("converts centimetres to feet and inches and back", () => {
    expect(cmToFtIn(182)).toEqual({ ft: 5, inches: 11.7 });
    expect(heightText(182, "ftin")).toBe("5 ft 11.7 in");
    expect(heightText(182, "cm")).toBe("182 cm");
    expect(heightText(152.4, "ftin")).toBe("5 ft 0 in");
    // 5 ft 11.7 in is 182.1 cm. A saved 182 that is shown and not edited stays 182: see profileUnits.test.ts.
    expect(parseFtIn("5", "11.7")).toBe(182.1);
    expect(parseFtIn("6", "")).toBe(182.9);
    expect(parseFtIn("5", "11,7")).toBe(182.1);
  });

  it("never shows 12 inches", () => {
    // 182.85 cm is 71.99 in: rounding has to carry into the feet.
    expect(cmToFtIn(182.85)).toEqual({ ft: 6, inches: 0 });
  });

  it("rejects what isn't a height from 100 to 250 cm", () => {
    expect(parseFtIn("", "11")).toBeNull();
    expect(parseFtIn("5.5", "0")).toBeNull();
    expect(parseFtIn("5", "12")).toBeNull();
    expect(parseFtIn("5", "1.25")).toBeNull();
    expect(parseFtIn("3", "3")).toBeNull();
    expect(parseFtIn("3", "3.4")).toBe(100.1);
    expect(parseFtIn("8", "3")).toBeNull();
    expect(heightRangeError("cm")).toBe("Height should be between 100 and 250 cm, with at most one decimal.");
    expect(heightRangeError("ftin")).toBe("Height should be between 3 ft 3.4 in and 8 ft 2.4 in.");
  });
});
