import { describe, expect, it } from "vitest";
import { atMostOneDecimal, parseDecimal } from "../src/lib/numbers";

describe("parseDecimal", () => {
  it("accepts a comma or a point", () => {
    expect(parseDecimal("83,4")).toBe(83.4);
    expect(parseDecimal("83.4")).toBe(83.4);
    expect(parseDecimal(" 180 ")).toBe(180);
    expect(parseDecimal("nope")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });

  it("checks one decimal place", () => {
    expect(atMostOneDecimal(83.4)).toBe(true);
    expect(atMostOneDecimal(83)).toBe(true);
    expect(atMostOneDecimal(83.44)).toBe(false);
  });
});
