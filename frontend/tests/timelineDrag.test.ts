import { describe, expect, it } from "vitest";
import { landing, setPlace, shiftOf, type Box } from "../src/lib/timelineDrag";

// Five 44px rows; the one at 88 is lifted.
const rows: Box[] = [0, 44, 88, 132, 176].map((top, n) => ({ key: `r${n}`, top, height: 44 }));
const others = rows.filter((row) => row.key !== "r2");

describe("where a drag lands", () => {
  it("stays put until it covers half of the next row, either way", () => {
    expect(landing(others, 88, 0, 44)).toBe(2);
    expect(landing(others, 88, 21, 44)).toBe(2);
    expect(landing(others, 88, 23, 44)).toBe(3);
    expect(landing(others, 88, -21, 44)).toBe(2);
    expect(landing(others, 88, -23, 44)).toBe(1);
  });

  it("goes by the leading edge, so a tall block moves on as soon as a short one would", () => {
    // Three rows lifted (a set and its two drop sets) at 0: down by half a row, its bottom passes the next middle.
    const short = [{ key: "a", top: 132, height: 44 }, { key: "b", top: 176, height: 44 }];
    expect(landing(short, 0, 23, 132)).toBe(1);
  });

  it("closes the rows up behind it and opens the gap where it is", () => {
    // Gap at 1 (between r0 and r1): r1 goes down by a row, r3 below the lifted one stays.
    expect(shiftOf(rows[1], 1, 1, 88, 44, true)).toBe(44);
    expect(shiftOf(rows[3], 2, 1, 88, 44, true)).toBe(0);
    // Gap at 3 (after r3): r3 moves up into the lifted one's place.
    expect(shiftOf(rows[3], 2, 3, 88, 44, true)).toBe(-44);
    // No gap where it can't go: nothing moves.
    expect(shiftOf(rows[3], 2, 3, 88, 44, false)).toBe(0);
  });
});

describe("which place a gap is", () => {
  const unit = { exercise: "a", start: 1, end: 2 };
  const set = (exercise: string, index: number) => ({ type: "set" as const, exercise, index });

  it("is before the set below, or after the set above at the end of an exercise", () => {
    expect(setPlace(set("a", 0), set("a", 2), unit)).toEqual({ key: "a", at: 1 });
    expect(setPlace(set("a", 3), { type: "exercise", exercise: "b", sets: 2, open: true }, unit)).toEqual({ key: "a", at: 3 });
    expect(setPlace(set("b", 1), undefined, unit)).toEqual({ key: "b", at: 2 });
  });

  it("is first in an open exercise below its heading, and last in a folded one", () => {
    expect(setPlace({ type: "exercise", exercise: "b", sets: 3, open: true }, { type: "other" }, unit)).toEqual({ key: "b", at: 0 });
    expect(setPlace({ type: "exercise", exercise: "b", sets: 3, open: false }, { type: "exercise", exercise: "c", sets: 1, open: false }, unit)).toEqual({ key: "b", at: 3 });
    expect(setPlace({ type: "exercise", exercise: "a", sets: 4, open: false }, undefined, unit)).toEqual({ key: "a", at: 3 });
  });

  it("is nowhere by the start or a part's heading", () => {
    expect(setPlace({ type: "other" }, { type: "exercise", exercise: "b", sets: 1, open: true }, unit)).toBeNull();
    expect(setPlace(undefined, { type: "other" }, unit)).toBeNull();
  });
});
