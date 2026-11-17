import { describe, expect, it } from "vitest";
import {
  amountErrorIn,
  foodAmountLabel,
  foodUnitOf,
  fromShown,
  isConverted,
  quickAmountsFor,
  readField,
  shownAmountLabel,
  shownField,
  shownText,
  shownWeightWord,
  sizeLabel,
  toShown,
  typingLimits,
} from "../src/lib/foodUnits";

describe("food units", () => {
  it("reads the setting, grams unless it is oz", () => {
    expect(foodUnitOf("oz")).toBe("oz");
    expect(foodUnitOf("g")).toBe("g");
    expect(foodUnitOf(undefined)).toBe("g");
  });

  it("converts only grams and ml, and only with oz", () => {
    expect(isConverted("g", "oz")).toBe(true);
    expect(isConverted("ml", "oz")).toBe(true);
    expect(isConverted("serving", "oz")).toBe(false);
    expect(isConverted("slice", "oz")).toBe(false);
    expect(isConverted("g", "g")).toBe(false);
    expect(shownWeightWord("g", "oz")).toBe("oz");
    expect(shownWeightWord("ml", "oz")).toBe("fl oz");
    expect(shownWeightWord("ml", "g")).toBe("ml");
  });

  it("keeps a typed ounce amount through the server's two gram decimals", () => {
    expect(fromShown(4, "g", "oz")).toBe(113.4);
    expect(toShown(113.4, "g", "oz")).toBe(4);
    expect(fromShown(8, "ml", "oz")).toBe(236.59);
    expect(toShown(236.59, "ml", "oz")).toBe(8);
    expect(toShown(150, "g", "oz")).toBe(5.3);
    for (let tenth = 1; tenth <= 3520; tenth += 7) {
      const typed = tenth / 10;
      expect(toShown(fromShown(typed, "g", "oz"), "g", "oz")).toBe(typed);
    }
  });

  it("leaves counts and metric alone", () => {
    expect(fromShown(2, "serving", "oz")).toBe(2);
    expect(toShown(150, "g", "g")).toBe(150);
    expect(shownText("150", "g", "g")).toBe("150");
    expect(shownText("150", "g", "oz")).toBe("5.3");
    expect(shownText("1", "piece", "oz")).toBe("1");
    expect(shownText("", "g", "oz")).toBe("");
  });

  it("labels stored and shown amounts", () => {
    expect(foodAmountLabel(113.4, "g", "oz")).toBe("4 oz");
    expect(foodAmountLabel(330, "ml", "oz")).toBe("11.2 fl oz");
    expect(foodAmountLabel(60, "g", "g")).toBe("60 g");
    expect(foodAmountLabel(2, "slice", "oz")).toBe("2 slices");
    expect(shownAmountLabel(4, "g", "oz")).toBe("4 oz");
    expect(shownAmountLabel(150, "g", "g")).toBe("150 g");
    expect(sizeLabel(150, "g", "oz")).toBe("5.3 oz");
    expect(sizeLabel(330, "ml", "oz")).toBe("11.2 fl oz");
    expect(sizeLabel(35.5, "g", "g")).toBe("35.5 g");
  });

  it("offers ounce chips and ounce-sized typing", () => {
    expect(quickAmountsFor("g", "oz")).toEqual([2, 4, 8]);
    expect(quickAmountsFor("ml", "oz")).toEqual([8, 12, 16]);
    expect(quickAmountsFor("g", "g")).toEqual([100, 150, 200]);
    expect(quickAmountsFor("serving", "oz")).toEqual([0.5, 1, 2, 3]);
    expect(typingLimits("g", "oz")).toEqual({ maxInt: 3, decimals: 1 });
    expect(typingLimits("g", "g")).toEqual({ maxInt: 5, decimals: 1 });
    expect(typingLimits("piece", "oz")).toEqual({ maxInt: 2, decimals: 2 });
  });

  it("words the amount limit in the shown unit", () => {
    expect(amountErrorIn(fromShown(400, "g", "oz"), "g", "oz")).toBe("Enter an amount above 0 and at most 352 oz.");
    expect(amountErrorIn(0, "ml", "oz")).toBe("Enter an amount above 0 and at most 338 fl oz.");
    expect(amountErrorIn(0, "g", "g")).toBe("Enter an amount above 0 and at most 10,000 g.");
    expect(amountErrorIn(fromShown(350, "g", "oz"), "g", "oz")).toBeNull();
  });
});

describe("fields filled from a stored amount", () => {
  it("save the stored amount until the text changes", () => {
    const field = shownField("150", "g", "oz");
    expect(field.text).toBe("5.3");
    expect(readField("5.3", "g", "oz", field)).toBe(150);
    expect(fromShown(5.3, "g", "oz")).toBe(150.25);
    expect(readField("5.4", "g", "oz", field)).toBe(153.09);
    expect(readField("5.3", "serving", "oz", field)).toBe(5.3);
    expect(readField("5.3", "g", "g", field)).toBe(5.3);
    expect(readField("2", "g", "g", null)).toBe(2);
  });
});
