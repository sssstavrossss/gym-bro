import { describe, expect, it } from "vitest";
import { exercisePlace, FINGER_CLEAR, joinAt, landing, raiseFor, runBlocks, setPlace, shiftOf, type Box, type Slot } from "../src/lib/timelineDrag";

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

describe("which place a gap is for an exercise", () => {
  // Start, WARM-UP, a, WORKOUT, a superset (run, b, c, merge), d, COOL-DOWN, e, the +.
  const rows: Slot[] = [
    { type: "other" },
    { type: "part", part: "warmup" },
    { type: "run", head: "a", part: "warmup" },
    { type: "part", part: null },
    { type: "run", head: "b", part: null },
    { type: "run", head: "b", part: null },
    { type: "run", head: "b", part: null },
    { type: "run", head: "b", part: null },
    { type: "run", head: "d", part: null },
    { type: "part", part: "cooldown" },
    { type: "run", head: "e", part: "cooldown" },
    { type: "other" },
  ];

  it("counts the exercises above it, and never stops inside a superset", () => {
    expect(exercisePlace(rows, 8)).toEqual({ gap: 8, at: 2 });
    expect(exercisePlace(rows, 5)).toEqual({ gap: 4, at: 1, part: null });
    expect(exercisePlace(rows, 7)).toEqual({ gap: 8, at: 2 });
  });

  it("goes in the part of the heading right above it, or of the exercise above a heading right below it", () => {
    expect(exercisePlace(rows, 2)).toEqual({ gap: 2, at: 0, part: "warmup" });
    expect(exercisePlace(rows, 3)).toEqual({ gap: 3, at: 1, part: "warmup" });
    expect(exercisePlace(rows, 10)).toEqual({ gap: 10, at: 3, part: "cooldown" });
    expect(exercisePlace(rows, 9)).toEqual({ gap: 9, at: 3, part: null });
  });

  it("stays after the start and before the +", () => {
    expect(exercisePlace(rows, 0)).toEqual({ gap: 1, at: 0 });
    expect(exercisePlace(rows, 12)).toEqual({ gap: 11, at: 4 });
  });
});

describe("which exercise a lifted one would join", () => {
  // The start, a (52px), a superset of b and c (run, b, c, merge), the +.
  const boxes: Box[] = [
    { key: "start", top: 0, height: 28 },
    { key: "ex:a", top: 28, height: 52 },
    { key: "run:b", top: 80, height: 40 },
    { key: "ex:b", top: 120, height: 52 },
    { key: "ex:c", top: 172, height: 52 },
    { key: "merge:b", top: 224, height: 24 },
    { key: "add", top: 248, height: 44 },
  ];
  const slots: Slot[] = [
    { type: "other" }, { type: "run", head: "a", part: null },
    { type: "run", head: "b", part: null }, { type: "run", head: "b", part: null }, { type: "run", head: "b", part: null }, { type: "run", head: "b", part: null },
    { type: "other" },
  ];
  const blocks = runBlocks(boxes, slots, (box) => box.top);

  it("groups a superset's rows into one block", () => {
    expect(blocks.map((block) => [block.index, block.keys.join(" "), block.top, block.bottom])).toEqual([
      [0, "ex:a", 28, 80],
      [1, "run:b ex:b ex:c merge:b", 80, 248],
    ]);
  });

  it("is the one whose middle it's over, never by its edges", () => {
    expect(joinAt(blocks, 54)?.index).toBe(0);
    expect(joinAt(blocks, 30)).toBeNull();
    expect(joinAt(blocks, 78)).toBeNull();
    expect(joinAt(blocks, 160)?.index).toBe(1);
    expect(joinAt(blocks, 100)).toBeNull();
  });

  it("goes by where the rows are drawn", () => {
    const moved = runBlocks(boxes, slots, (box, at) => box.top + (at >= 2 ? 52 : 0));
    expect(moved[1].top).toBe(132);
    expect(joinAt(moved, 160)).toBeNull();
  });
});

describe("raiseFor", () => {
  it("floats rows held on a touch screen with their bottom a little over the finger", () => {
    // A 60px row held 20px down: drawn 40px up puts its bottom at the finger, and FINGER_CLEAR more clears it.
    expect(raiseFor(true, 60, 20)).toBe(40 + FINGER_CLEAR);
    expect(raiseFor(true, 60, 60)).toBe(FINGER_CLEAR);
  });
  it("leaves them where they were picked up under a mouse pointer", () => {
    expect(raiseFor(false, 60, 20)).toBe(0);
  });
});
