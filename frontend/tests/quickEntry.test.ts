import { describe, expect, it } from "vitest";
import { nextQuickInput, nextQuickNumber } from "../src/lib/quickEntry";

describe("quick-add re-entry", () => {
  it("replaces 25 with 30 on the first new digits", () => {
    let value = "25";
    let replace = true;
    value = nextQuickNumber(value, "3", replace, 5);
    replace = false;
    value = nextQuickNumber(value, "0", replace, 5);
    expect(value).toBe("30");
  });

  it("keeps the value when focus leaves and comes back before a key", () => {
    expect(nextQuickNumber("25", "3", true, 5)).toBe("3");
    expect("25").toBe("25");
  });

  it("appends after the first replacement digit", () => {
    expect(nextQuickNumber("3", "0", false, 5)).toBe("30");
  });

  it("turns a leading zero into the next digit", () => {
    expect(nextQuickNumber("", "0", true, 4)).toBe("0");
    expect(nextQuickNumber("0", "4", false, 4)).toBe("4");
  });

  it("starts a decimal from the existing number", () => {
    expect(nextQuickNumber("25", ".", true, 4)).toBe("0.");
    expect(nextQuickNumber("0.", "5", false, 4)).toBe("0.5");
    expect(nextQuickNumber("25", ",", true, 4)).toBe("0.");
  });

  it("edits with the first backspace instead of wiping the field", () => {
    expect(nextQuickNumber("25", "⌫", true, 4)).toBe("2");
    expect(nextQuickNumber("2", "0", false, 4)).toBe("20");
  });

  it("still stops at the integer bound", () => {
    expect(nextQuickNumber("9999", "9", false, 4)).toBe("9999");
    expect(nextQuickNumber("9999", "3", true, 4)).toBe("3");
  });

  it("treats a typed suffix or prefix as the new entry", () => {
    expect(nextQuickInput("25", "253", true, 6)).toBe("3");
    expect(nextQuickInput("25", "325", true, 6)).toBe("3");
    expect(nextQuickInput("3", "30", false, 6)).toBe("30");
  });

  it("keeps a selection that already replaced the old number", () => {
    expect(nextQuickInput("25", "30", true, 6)).toBe("30");
    expect(nextQuickInput("25", "3,5", true, 6)).toBe("3.5");
  });

  it("does not change the stored value when the typed text is unchanged", () => {
    expect(nextQuickInput("25", "25", true, 6)).toBe("25");
  });
});
