import { describe, expect, it } from "vitest";
import { nextQuickInput } from "../src/lib/quickEntry";

describe("quick-add re-entry", () => {
  it("treats a typed suffix or prefix as the new entry", () => {
    expect(nextQuickInput("25", "253", true, 6)).toBe("3");
    expect(nextQuickInput("25", "325", true, 6)).toBe("3");
    expect(nextQuickInput("3", "30", false, 6)).toBe("30");
  });

  it("keeps a selection that already replaced the old number", () => {
    expect(nextQuickInput("25", "30", true, 6)).toBe("30");
    expect(nextQuickInput("25", "3,5", true, 6)).toBe("3.5");
  });

  it("keeps the decimal when a new weight is typed onto a decimal value", () => {
    expect(nextQuickInput("84.0", "84.038.6", true, 6)).toBe("38.6");
    expect(nextQuickInput("84.0", "38.684.0", true, 6)).toBe("38.6");
  });

  it("does not change the stored value when the typed text is unchanged", () => {
    expect(nextQuickInput("25", "25", true, 6)).toBe("25");
  });
});
