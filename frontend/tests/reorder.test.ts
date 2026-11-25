import { describe, expect, it } from "vitest";
import { dropIndex, rowShift, stepIndex } from "../src/lib/reorder";

const rows = [
  { top: 0, height: 52 },
  { top: 52, height: 52 },
  { top: 104, height: 72 },
  { top: 176, height: 52 },
];

describe("dropIndex", () => {
  it("stays put until the row's middle passes a neighbour's", () => {
    expect(dropIndex(rows, 1, 0)).toBe(1);
    expect(dropIndex(rows, 1, 30)).toBe(1);
    // Row 1's middle (78) + 63 = 141 passes row 2's middle (140).
    expect(dropIndex(rows, 1, 63)).toBe(2);
    expect(dropIndex(rows, 3, -200)).toBe(0);
    expect(dropIndex(rows, 0, 500)).toBe(3);
  });

  it("keeps an unknown row where it is", () => {
    expect(dropIndex(rows, 9, 40)).toBe(9);
  });
});

describe("rowShift", () => {
  it("slides the rows passed into the gap the dragged row left", () => {
    // Row 0 dragged to 2: rows 1 and 2 move up by its height.
    expect([0, 1, 2, 3].map((index) => rowShift(index, 0, 2, 52))).toEqual([0, -52, -52, 0]);
    // Row 3 dragged to 1: rows 1 and 2 move down.
    expect([0, 1, 2, 3].map((index) => rowShift(index, 3, 1, 52))).toEqual([0, 52, 52, 0]);
    expect([0, 1, 2, 3].map((index) => rowShift(index, 2, 2, 72))).toEqual([0, 0, 0, 0]);
  });
});

describe("stepIndex", () => {
  it("moves one place and stops at the ends", () => {
    expect(stepIndex(2, -1, 4)).toBe(1);
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(3, 1, 4)).toBe(3);
  });
});
