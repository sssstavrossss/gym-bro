import { describe, expect, it } from "vitest";
import { acceptCopyDate, copyDates, copyDayLabel } from "../src/lib/copyDays";
import {
  activateMark,
  activateRow,
  emptySelection,
  longPressMoved,
  longPressMs,
  rangeIds,
  settledSwipe,
  toggleGroup,
} from "../src/lib/selection";

const ids = ["a", "b", "c", "d"];

describe("selecting log entries", () => {
  it("starts from a modifier click and extends with shift", () => {
    const first = activateRow(emptySelection(), ids, "b", { shift: false, toggle: true });
    expect(first).toEqual({ selecting: true, selected: ["b"], anchor: "b" });
    if (first === "edit") return;
    const range = activateRow(first, ids, "d", { shift: true, toggle: true });
    expect(range).toEqual({ selecting: true, selected: ["b", "c", "d"], anchor: "d" });
  });

  it("toggles inside select mode and leaves it when the last row is cleared", () => {
    const on = { selecting: true, selected: ["a"], anchor: "a" };
    const off = activateRow(on, ids, "a", { shift: false, toggle: false });
    expect(off).toEqual({ selecting: false, selected: [], anchor: "a" });
  });

  it("edits on a plain click and uses the circle without a modifier", () => {
    expect(activateRow(emptySelection(), ids, "a", { shift: false, toggle: false })).toBe("edit");
    expect(activateMark(emptySelection(), ids, "c", false)).toEqual({ selecting: true, selected: ["c"], anchor: "c" });
    expect(rangeIds(ids, "a", "c", [])).toEqual(["a", "b", "c"]);
    expect(toggleGroup(["a", "b"], ["a", "b"])).toEqual([]);
    expect(toggleGroup(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("treats a held touch as selection and a sideways drag as a swipe", () => {
    expect(longPressMs).toBeGreaterThanOrEqual(480);
    expect(longPressMoved(0, 0)).toBe(false);
    expect(longPressMoved(9, 0)).toBe(true);
    expect(settledSwipe(-20, 144)).toBe(0);
    expect(settledSwipe(-80, 144)).toBe(-144);
  });
});

describe("copy dates", () => {
  it("starts at today and never offers a future day or a day before setup", () => {
    expect(copyDates("2026-11-09", "2026-11-01")).toEqual([
      "2026-11-09",
      "2026-11-08",
      "2026-11-07",
      "2026-11-06",
      "2026-11-05",
      "2026-11-04",
      "2026-11-03",
    ]);
    expect(copyDates("2026-11-09", "2026-11-09")).toEqual(["2026-11-09"]);
    expect(copyDates("2026-11-09", "2026-11-07").every((day) => day <= "2026-11-09" && day >= "2026-11-07")).toBe(true);
    expect(acceptCopyDate("2026-11-10", "2026-11-09", "2026-11-01")).toBe(false);
    expect(acceptCopyDate("2026-10-31", "2026-11-09", "2026-11-01")).toBe(false);
    expect(acceptCopyDate("2026-11-09", "2026-11-09", "2026-11-01")).toBe(true);
    expect(acceptCopyDate("2026-11-01", "2026-11-09", "2026-11-01")).toBe(true);
    expect(copyDayLabel("2026-11-09", "2026-11-09")).toBe("Today");
    expect(copyDayLabel("2026-11-08", "2026-11-09")).toBe("Yesterday");
  });
});
