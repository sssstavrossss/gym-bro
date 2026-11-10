import { describe, expect, it } from "vitest";
import {
  byTime,
  clampLogDate,
  dayTotalText,
  fastingHint,
  nextFasting,
  shiftLogDate,
  summaryCells,
  targetLine,
  weekDays,
} from "../src/lib/dayLog";
import { addNeedsTime, sameAddTap } from "../src/lib/foodSheet";

const target = {
  kcal: 2151,
  protein: 160,
  fat: 60,
  carbs: 200,
  effectiveDate: "2026-10-22",
  reason: "profile_change",
};

describe("day navigation", () => {
  it("offers no future day and stops at the setup date", () => {
    expect(clampLogDate("2026-11-02", "2026-11-01", "2026-10-20")).toBe("2026-11-01");
    expect(clampLogDate("nope", "2026-11-01", "2026-10-20")).toBe("2026-11-01");
    expect(clampLogDate("2026-10-01", "2026-11-01", "2026-10-20")).toBe("2026-10-20");
    expect(shiftLogDate("2026-11-01", 1, "2026-11-01", "2026-10-20")).toBeNull();
    expect(shiftLogDate("2026-10-20", -1, "2026-11-01", "2026-10-20")).toBeNull();
    expect(shiftLogDate("2026-10-21", -1, "2026-11-01", "2026-10-20")).toBe("2026-10-20");

    const days = weekDays("2026-11-04", "2026-11-04", "2026-11-04", "2026-11-03", ["2026-11-03", "2026-11-05"]);
    expect(days.find((day) => day.date === "2026-11-02")?.disabled).toBe(true);
    expect(days.find((day) => day.date === "2026-11-03")?.logged).toBe(true);
    expect(days.filter((day) => day.date > "2026-11-04").every((day) => day.disabled && !day.logged)).toBe(true);
    const wednesday = days.find((day) => day.date === "2026-11-04");
    expect(wednesday?.disabled).toBe(false);
    expect(wednesday?.label).toBe("W4, Wednesday 4, nothing logged, today, selected");
    expect(days.find((day) => day.date === "2026-11-02")?.label).toBe("M2, Monday 2, before you set up");
    expect(days.find((day) => day.date === "2026-11-03")?.label).toBe("T3, Tuesday 3, logged");
    expect(days.find((day) => day.date === "2026-11-05")?.label).toBe("T5, Thursday 5, later");
    expect(days.find((day) => day.date === "2026-11-06")?.label).toBe("F6, Friday 6, later");
  });
});

describe("past-day add", () => {
  it("stays disabled until a time is picked, and today still defaults to now", () => {
    expect(addNeedsTime("2026-11-08", "2026-11-09", null, false)).toBe(true);
    expect(addNeedsTime("2026-11-08", "2026-11-09", "08:15", false)).toBe(false);
    expect(addNeedsTime("2026-11-09", "2026-11-09", null, false)).toBe(false);
    expect(addNeedsTime("2026-11-08", "2026-11-09", null, true)).toBe(false);
    expect(sameAddTap(1_000, 1_400)).toBe(true);
    expect(sameAddTap(1_000, 1_700)).toBe(false);
  });
});

describe("fasting day", () => {
  it("is its own switch and is not cleared by having food", () => {
    expect(nextFasting(true)).toBe(true);
    expect(nextFasting(false)).toBe(false);
    expect(fastingHint).toContain("does not clear");
  });
});

describe("timeline and targets", () => {
  it("orders entries by time and does not judge a day before the first target", () => {
    const rows = byTime([
      { id: "c", time: "18:00" },
      { id: "a", time: "07:30" },
      { id: "b", time: "12:00" },
      { id: "d", time: "07:30" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "d", "b", "c"]);
    const bare = summaryCells({ kcal: 400, p: 10, f: 5, c: 40 }, null);
    expect(bare.every((cell) => !cell.over)).toBe(true);
    expect(bare[0].caption).toBe("kcal");
    expect(targetLine(null, "2026-10-22")).toBe("No target on this day · targets start 22 Oct");
    expect(targetLine(null, null)).toBe("No target on this day");
    const judged = summaryCells({ kcal: 3000, p: 10, f: 5, c: 40 }, target);
    expect(judged[0].over).toBe(true);
    expect(judged[0].caption).toBe("/ 2,151 kcal");
    expect(targetLine(target, "2026-10-22")).toBe("Target 2,151 kcal · since 22 Oct · Profile change");
    expect(dayTotalText(1240, 3)).toBe("1,240 kcal · 3 items");
    expect(dayTotalText(40, 1)).toBe("40 kcal · 1 item");
  });
});
