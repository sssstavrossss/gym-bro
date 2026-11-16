import { describe, expect, it } from "vitest";
import { kg, roundHalfAwayFromZero, signed } from "../src/lib/format";

describe("one decimal half away from zero", () => {
  it("rounds the halfway trends the server shows", () => {
    expect(kg(80.05)).toBe("80.1");
    expect(kg(80.35)).toBe("80.4");
    expect(kg(80.55)).toBe("80.6");
    expect(kg(80.85)).toBe("80.9");
  });

  it("rounds a negative delta away from zero and leaves a non-midpoint", () => {
    expect(kg(-0.05)).toBe("-0.1");
    expect(signed(-0.05)).toBe("−0.1");
    expect(roundHalfAwayFromZero(-0.05)).toBeCloseTo(-0.1);
    expect(kg(80.04)).toBe("80.0");
  });
});
