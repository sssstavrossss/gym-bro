import { describe, expect, it } from "vitest";
import { tabDestination } from "../src/lib/focusTrap";
import { keyboardInset, screenLayout, screenLayoutFromFlags, shortcutEffect, shortcutHint } from "../src/lib/layout";
import { judgeWeekDay, type DayTarget, type MacroTotals } from "../src/lib/weekCard";

const base = {
  meta: false,
  ctrl: false,
  alt: false,
  composing: false,
  typing: false,
  sheet: null,
  selecting: false,
  nav: true,
} as const;

describe("keyboard inset", () => {
  it("lifts a sheet by the part of the layout viewport the keyboard covers", () => {
    expect(keyboardInset(800, 800, 0)).toBe(0);
    expect(keyboardInset(800, 420, 0)).toBe(380);
    expect(keyboardInset(800, 420, 20)).toBe(360);
    expect(keyboardInset(800, 900, 0)).toBe(0);
    expect(keyboardInset(Number.NaN, 400, 0)).toBe(0);
  });
});

describe("screen layout", () => {
  it("keeps phone under 600, tablet through 1,023, and desktop from 1,024", () => {
    expect(screenLayout(375)).toBe("phone");
    expect(screenLayout(599)).toBe("phone");
    expect(screenLayout(600)).toBe("tablet");
    expect(screenLayout(768)).toBe("tablet");
    expect(screenLayout(1023)).toBe("tablet");
    expect(screenLayout(1024)).toBe("two");
    expect(screenLayout(1279)).toBe("two");
    expect(screenLayout(1280)).toBe("three");
    expect(screenLayout(1920)).toBe("three");
  });

  it("follows the same flags the viewport media queries set", () => {
    expect(screenLayoutFromFlags({ tablet: false, desktop: false, wide: false })).toBe("phone");
    expect(screenLayoutFromFlags({ tablet: true, desktop: false, wide: false })).toBe("tablet");
    expect(screenLayoutFromFlags({ tablet: true, desktop: true, wide: false })).toBe("two");
    expect(screenLayoutFromFlags({ tablet: true, desktop: true, wide: true })).toBe("three");
  });
});

describe("shortcuts", () => {
  it("lists the keys in the sentence shown in the sidebar", () => {
    expect(shortcutHint).toBe("N or / add food · Q quick add · W weight · Esc close");
  });

  it("opens add food, quick add, and weight", () => {
    expect(shortcutEffect({ ...base, key: "n" })).toEqual({ effect: "prevent", action: "add" });
    expect(shortcutEffect({ ...base, key: "N" })).toEqual({ effect: "prevent", action: "add" });
    expect(shortcutEffect({ ...base, key: "/" })).toEqual({ effect: "prevent", action: "add" });
    expect(shortcutEffect({ ...base, key: "q" })).toEqual({ effect: "prevent", action: "quick" });
    expect(shortcutEffect({ ...base, key: "w" })).toEqual({ effect: "prevent", action: "weight" });
  });

  it("does not fire letter shortcuts while typing, in a sheet, or before the shell", () => {
    expect(shortcutEffect({ ...base, key: "n", typing: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "/", typing: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "q", typing: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "w", sheet: "food" })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "n", nav: false })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "n", meta: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "n", ctrl: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "n", alt: true })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "n", composing: true })).toEqual({ effect: "none" });
  });

  it("lets Esc close a sheet even from a field, and ignores it otherwise", () => {
    expect(shortcutEffect({ ...base, key: "Escape", typing: true, sheet: "food" })).toEqual({ effect: "prevent", action: "close-sheet" });
    expect(shortcutEffect({ ...base, key: "Escape", sheet: "weight" })).toEqual({ effect: "prevent", action: "close-sheet" });
    expect(shortcutEffect({ ...base, key: "Escape", sheet: "copy" })).toEqual({ effect: "prevent", action: "close-copy" });
    expect(shortcutEffect({ ...base, key: "Escape", sheet: "group" })).toEqual({ effect: "prevent", action: "close-group" });
    expect(shortcutEffect({ ...base, key: "Escape", sheet: "recipe" })).toEqual({ effect: "prevent", action: "close-recipe" });
    expect(shortcutEffect({ ...base, key: "Escape", selecting: true })).toEqual({ effect: "prevent", action: "end-select" });
    expect(shortcutEffect({ ...base, key: "Escape" })).toEqual({ effect: "none" });
    expect(shortcutEffect({ ...base, key: "Escape", typing: true })).toEqual({ effect: "none" });
  });
});

describe("focus cycle", () => {
  it("wraps at the ends and pulls escaped focus back in", () => {
    expect(tabDestination(4, 3, false, true)).toBe(0);
    expect(tabDestination(4, 0, true, true)).toBe(3);
    expect(tabDestination(4, 1, false, true)).toBeNull();
    expect(tabDestination(4, -1, false, false)).toBe(0);
    expect(tabDestination(4, -1, true, false)).toBe(3);
    expect(tabDestination(0, 0, false, true)).toBe(-1);
  });
});

const onTarget: MacroTotals = { kcal: 2200, protein: 170, fat: 60, carbs: 250 };
const target: DayTarget = { kcal: 2218, protein: 167, fat: 62, carbs: 249 };

describe("this week", () => {
  it("judges each day against its own target with the decision 7 rule", () => {
    const monday = judgeWeekDay({ date: "2026-11-02", today: "2026-11-04", logged: true, eaten: onTarget, target });
    expect(monday.on).toBe(true);
    expect(monday.over).toBe(false);
    expect(monday.bar).toBeCloseTo(onTarget.kcal / (target.kcal * 1.2));

    const stricter = judgeWeekDay({
      date: "2026-11-03",
      today: "2026-11-04",
      logged: true,
      eaten: onTarget,
      target: { ...target, kcal: 2000 },
    });
    expect(stricter.on).toBe(false);
    expect(stricter.over).toBe(true);
    expect(stricter.targetKcal).toBe(2000);
  });

  it("withholds the tick when protein, fat, or carbs miss, and when the day is over", () => {
    const lowProtein = judgeWeekDay({
      date: "2026-11-04",
      today: "2026-11-04",
      logged: true,
      eaten: { ...onTarget, protein: 100 },
      target,
    });
    expect(lowProtein.on).toBe(false);
    expect(lowProtein.over).toBe(false);

    const over = judgeWeekDay({
      date: "2026-11-04",
      today: "2026-11-04",
      logged: true,
      eaten: { ...onTarget, kcal: 2600, protein: 200 },
      target,
    });
    expect(over.over).toBe(true);
    expect(over.on).toBe(false);
  });

  it("does not judge a future day, an empty day, or a day with no target", () => {
    expect(judgeWeekDay({ date: "2026-11-05", today: "2026-11-04", logged: false, eaten: null, target }).future).toBe(true);
    expect(judgeWeekDay({ date: "2026-11-05", today: "2026-11-04", logged: false, eaten: null, target }).on).toBe(false);
    const empty = judgeWeekDay({ date: "2026-11-01", today: "2026-11-04", logged: false, eaten: null, target });
    expect(empty.logged).toBe(false);
    expect(empty.on).toBe(false);
    expect(empty.bar).toBeNull();
    expect(empty.targetKcal).toBe(target.kcal);
    const none = judgeWeekDay({ date: "2026-11-01", today: "2026-11-04", logged: true, eaten: onTarget, target: null });
    expect(none.targetKcal).toBeNull();
    expect(none.on).toBe(false);
  });
});
