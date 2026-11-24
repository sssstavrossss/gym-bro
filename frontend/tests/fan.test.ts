import { describe, expect, it } from "vitest";
import { FAN_ACTIONS, fanActions, fanAngle, fanPages, fanRadius, fanScale, fanTurn } from "../src/lib/fan";

describe("the + fan", () => {
  it("puts Search, Scan, Describe, Quick add and Weight on page one, and the rest on page two", () => {
    const pages = fanPages(fanActions(true));
    expect(pages.map((page) => page.map((action) => action.label))).toEqual([
      ["Search", "Scan", "Describe", "Quick add", "Weight"],
      ["New recipe", "New food", "Recipes", "My foods", "Groups"],
    ]);
  });

  it("leaves Describe out when the server can't describe meals", () => {
    const labels = fanActions(false).map((action) => action.label);
    expect(labels).not.toContain("Describe");
    expect(labels).toHaveLength(FAN_ACTIONS.length - 1);
    expect(fanPages(fanActions(false)).map((page) => page.length)).toEqual([5, 4]);
  });

  it("spreads a page over the top of the ring, centred on straight up, first on the left", () => {
    expect([0, 1, 2, 3, 4].map((at) => fanAngle(at, 5))).toEqual([144, 117, 90, 63, 36]);
    expect([0, 1, 2, 3].map((at) => fanAngle(at, 4))).toEqual([130.5, 103.5, 76.5, 49.5]);
    expect(fanAngle(0, 1)).toBe(90);
  });

  it("shrinks the ring on a narrow screen so the outer labels stay on it", () => {
    expect(fanRadius(390, 195)).toBe(176);
    expect(fanRadius(375, 187.5)).toBe(172);
    expect(fanRadius(320, 160)).toBe(138);
    expect(fanScale(176)).toBe(1);
    expect(fanScale(138)).toBe(0.8);
    // Never so small that the buttons crowd the +.
    expect(fanRadius(200, 100)).toBe(112);
  });

  it("wraps past the last page to the first, both ways", () => {
    expect(fanTurn(0, 1, 2)).toBe(1);
    expect(fanTurn(1, 1, 2)).toBe(0);
    expect(fanTurn(0, -1, 2)).toBe(1);
    expect(fanTurn(0, 1, 1)).toBe(0);
    expect(fanTurn(0, 1, 0)).toBe(0);
  });
});
