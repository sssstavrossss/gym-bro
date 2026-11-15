import { describe, expect, it } from "vitest";
import { capHeight, scrollMark } from "../src/lib/scrollCap";

describe("scroll cap", () => {
  it("caps at the fifth row only when there are more", () => {
    expect(capHeight([52, 104, 156, 208, 260], 5)).toBeNull();
    expect(capHeight([52, 104, 156, 208, 260.4, 312], 5)).toBe(261);
    expect(capHeight([52, 104], 0)).toBeNull();
  });

  it("places the thumb and fades the edges that hide rows", () => {
    expect(scrollMark(0, 260, 260)).toEqual({ above: false, below: false, thumbTop: 0, thumbHeight: 100 });
    const top = scrollMark(0, 416, 260);
    expect(top.above).toBe(false);
    expect(top.below).toBe(true);
    expect(top.thumbTop).toBe(0);
    expect(top.thumbHeight).toBeCloseTo(62.5);
    const end = scrollMark(156, 416, 260);
    expect(end.above).toBe(true);
    expect(end.below).toBe(false);
    expect(end.thumbTop + end.thumbHeight).toBeCloseTo(100);
    const middle = scrollMark(78, 416, 260);
    expect(middle.above && middle.below).toBe(true);
    expect(scrollMark(500, 416, 260).thumbTop + scrollMark(500, 416, 260).thumbHeight).toBeCloseTo(100);
    expect(scrollMark(0, 10000, 260).thumbHeight).toBe(12);
  });
});
