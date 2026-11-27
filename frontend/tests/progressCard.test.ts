import { describe, expect, it } from "vitest";
import { barWidth, canGoEarlier, chartLayout, fiberMinimum, goalKind, intakeScale, intakeStats, metGoal, monthTicks, PROGRESS_PAGES, rangeEnd, targetSteps, visibleSpan } from "../src/lib/progressCard";

const day = (date: string, value: number | null, target: number | null) => ({ date, logged: value != null, value, target });

describe("progress card", () => {
  it("scrolls only All past six months, at the six-month scale", () => {
    expect(chartLayout("6m", 183, 300)).toEqual({ contentWidth: 300, scrollable: false });
    expect(chartLayout("all", 120, 300)).toEqual({ contentWidth: 300, scrollable: false });
    expect(chartLayout("all", 366, 300)).toEqual({ contentWidth: 600, scrollable: true });
  });

  it("thins bars as the range grows", () => {
    expect(barWidth(300, 7)).toBe(10);
    expect(barWidth(300, 30)).toBe(6);
    expect(barWidth(300, 90)).toBe(2);
    expect(barWidth(300, 183)).toBe(1);
    expect(barWidth(300, 0)).toBe(0);
  });

  it("draws targets as flat steps that start with the first target", () => {
    const steps = targetSteps([day("a", 1, null), day("b", 1, 100), day("c", 1, 100), day("d", 1, 120), day("e", null, null), day("f", 1, 120)]);
    expect(steps).toEqual([{ from: 1, to: 2, value: 100 }, { from: 3, to: 3, value: 120 }, { from: 5, to: 5, value: 120 }]);
  });

  it("counts a minimum as reached, a target as within 10%, and a limit as at or under", () => {
    const days = [day("a", 160, 168), day("b", 170, 168), day("c", null, 168), day("d", 180, 168)];
    expect(intakeStats(days, "minimum")).toEqual({ average: 170, target: 168, logged: 3, total: 4, hit: 2 });
    expect(intakeStats(days, "target").hit).toBe(3);
    expect(intakeStats(days, "limit").hit).toBe(1);
    expect(intakeStats([day("a", null, null)], "target").average).toBeNull();
    expect(metGoal(25, 25, "limit")).toBe(true);
    expect(metGoal(25.1, 25, "limit")).toBe(false);
    expect(metGoal(10, null, "limit")).toBe(false);
    expect(PROGRESS_PAGES.filter((page) => page !== "burn").map(goalKind)).toEqual(["target", "target", "minimum", "target", "target", "minimum", "limit", "limit"]);
    expect(fiberMinimum("male")).toBe(35);
    expect(fiberMinimum("female")).toBe(25);
    expect(fiberMinimum("")).toBeNull();
  });

  it("labels months and reports the days in view", () => {
    const dates = ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-02-01", "2026-03-01"];
    expect(monthTicks(dates, 600, 48)).toEqual([{ index: 2, text: "Jan 26" }, { index: 4, text: "Feb" }, { index: 5, text: "Mar" }]);
    expect(monthTicks(dates, 120, 48).map((tick) => tick.text)).toEqual(["Jan 26", "Mar"]);
    expect(visibleSpan(dates, 200, 200, 600)).toEqual({ from: "2026-01-01", to: "2026-01-02" });
    expect(visibleSpan(dates, 400, 200, 600)).toEqual({ from: "2026-02-01", to: "2026-03-01" });
  });

  it("rounds the bar scale to even ticks", () => {
    expect(intakeScale(2617)).toEqual({ top: 3000, ticks: [0, 1000, 2000, 3000] });
    expect(intakeScale(168)).toEqual({ top: 200, ticks: [0, 100, 200] });
    expect(intakeScale(35)).toEqual({ top: 40, ticks: [0, 20, 40] });
    expect(intakeScale(0).ticks[0]).toBe(0);
  });

  it("steps a fixed range back a whole range at a time, and All not at all", () => {
    expect(rangeEnd("2026-11-27", "7d", 0)).toBeNull();
    expect(rangeEnd("2026-11-27", "7d", 1)).toBe("2026-11-20");
    expect(rangeEnd("2026-11-27", "7d", 2)).toBe("2026-11-13");
    expect(rangeEnd("2026-11-27", "30d", 1)).toBe("2026-10-28");
    expect(rangeEnd("2026-11-27", "6m", 1)).toBe("2026-05-29");
    expect(rangeEnd("2026-11-27", "all", 1)).toBeNull();
  });

  it("goes earlier only while there is something before the range", () => {
    expect(canGoEarlier("7d", "2026-11-21", "2026-10-01")).toBe(true);
    expect(canGoEarlier("7d", "2026-10-01", "2026-10-01")).toBe(false);
    expect(canGoEarlier("7d", "2026-11-21", null)).toBe(false);
    expect(canGoEarlier("all", "2026-11-21", "2026-10-01")).toBe(false);
  });
});
