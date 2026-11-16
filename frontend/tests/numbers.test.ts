import { describe, expect, it } from "vitest";
import { atMostOneDecimal, nudgeTenth, parseDecimal, typeInto } from "../src/lib/numbers";

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

describe("typeInto", () => {
  it("types digits, one point, and caps decimals", () => {
    expect(typeInto("", "8", 3)).toBe("8");
    expect(typeInto("82", ".", 3)).toBe("82.");
    expect(typeInto("82.4", "5", 3)).toBe("82.4");
    expect(typeInto("82.4", ".", 3)).toBe("82.4");
    expect(typeInto("", ".", 3)).toBe("0.");
  });
  it("caps whole digits and deletes", () => {
    expect(typeInto("184", "2", 3)).toBe("184");
    expect(typeInto("82.4", "⌫", 3)).toBe("82.");
    expect(typeInto("8", "⌫", 3)).toBe("");
    expect(typeInto("0", "7", 3)).toBe("7");
  });
});

describe("nudgeTenth", () => {
  it("steps a tenth without float drift", () => {
    expect(nudgeTenth(82.6, -1, 30, 300)).toBe(82.5);
    expect(nudgeTenth(82.9, 1, 30, 300)).toBe(83);
    expect(nudgeTenth(0.3, 1, 0, 1)).toBe(0.4);
  });
  it("stays inside the range", () => {
    expect(nudgeTenth(30, -1, 30, 300)).toBe(30);
    expect(nudgeTenth(300, 1, 30, 300)).toBe(300);
  });
});
