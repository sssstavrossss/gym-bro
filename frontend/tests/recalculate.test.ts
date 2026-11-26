import { describe, expect, it } from "vitest";
import type { BurnReading, RecalculateStep } from "../src/api";
import {
  bannerVisible,
  burnStrip,
  capPercent,
  farNote,
  farTitle,
  lowChoice,
  lowSummary,
  lowTitle,
  moveCaption,
  percentOfTarget,
  readingNote,
  readingsCaption,
  periodLabel,
  stepCaption,
  stepPercent,
  targetLine,
  unreadCount,
  type LowDay,
} from "../src/lib/recalculate";

const low = (date: string, included: boolean): LowDay => ({ date, kcal: 1540, targetKcal: 2234, included });

describe("recalculate banner", () => {
  it("stays up through the week until a recalculation or a dismissal", () => {
    expect(bannerVisible(false, false)).toBe(true);
    expect(bannerVisible(true, false)).toBe(false);
    expect(bannerVisible(false, true)).toBe(false);
    expect(unreadCount([{ readAt: null }, { readAt: "2026-11-10T00:00:00Z" }])).toBe(1);
  });
});

describe("low days", () => {
  it("reads the choice from the days", () => {
    expect(lowChoice([])).toBeNull();
    expect(lowChoice([low("2026-11-02", true), low("2026-11-06", true)])).toBe("count");
    expect(lowChoice([low("2026-11-02", false), low("2026-11-06", false)])).toBe("leave");
    expect(lowChoice([low("2026-11-02", true), low("2026-11-06", false)])).toBe("mixed");
  });

  it("names the count and the share of the target", () => {
    expect(lowTitle(1)).toBe("1 day looks low");
    expect(lowTitle(3)).toBe("3 days look low");
    expect(lowSummary(3, "count")).toBe("3 low days counted");
    expect(lowSummary(1, "leave")).toBe("1 low day left out");
    expect(lowSummary(2, "mixed")).toBe("2 low days: some counted");
    expect(percentOfTarget(low("2026-11-02", true))).toBe(69);
    expect(percentOfTarget({ date: "2026-11-02", kcal: 900, targetKcal: null, included: true })).toBeNull();
  });
});

describe("burn strip", () => {
  it("pads the scale to round ticks and places the band and both dots", () => {
    // Values run 2412 to 2784; padded by 37 and rounded to 50 the scale is 2350 to 2850.
    const strip = burnStrip(2784, 2558, 146, 2590);
    expect(strip.min).toBe(2350);
    expect(strip.max).toBe(2850);
    expect(strip.ticks).toEqual([2400, 2500, 2600, 2700, 2800]);
    expect(strip.was).toBeCloseTo(((2784 - 2350) / 500) * 100);
    expect(strip.now).toBeCloseTo(((2590 - 2350) / 500) * 100);
    expect(strip.band.left).toBeCloseTo(((2412 - 2350) / 500) * 100);
    expect(strip.band.width).toBeCloseTo((292 / 500) * 100);
  });

  it("widens the tick step for a wide range", () => {
    const strip = burnStrip(3400, 2400, 300, 2600);
    expect(strip.ticks.length).toBeLessThanOrEqual(5);
    expect(strip.ticks.length).toBeGreaterThanOrEqual(3);
    expect(strip.ticks.every((tick) => tick % 250 === 0 || tick % 200 === 0 || tick % 500 === 0)).toBe(true);
  });

  it("keeps a tiny range readable", () => {
    const strip = burnStrip(2500, 2500, 10, 2500);
    expect(strip.min).toBe(2450);
    expect(strip.max).toBe(2550);
    expect(strip.ticks).toEqual([2450, 2500, 2550]);
    expect(strip.was).toBe(strip.now);
  });

  it("formats the step and the period", () => {
    expect(stepPercent(0.857)).toBe("86%");
    expect(periodLabel(56, true)).toBe("Last 8 weeks");
    expect(periodLabel(21, false)).toBe("21 days");
    expect(periodLabel(1, false)).toBe("1 day");
  });
});

describe("burn text", () => {
  it("explains the measurement, the step and the target", () => {
    expect(stepCaption(0.86)).toContain("moved 86% of the way to it because your weigh-ins line up well.");
    expect(stepCaption(0.3)).toContain("because there are few weigh-ins or they jump around.");
    expect(stepCaption(0.5)).toContain("moved 50% of the way to it. Few");
    expect(targetLine(2590, 2040, "lose", "0.5 kg")).toBe("Target = burn 2,590 − 550 to lose 0.5 kg a week.");
    expect(targetLine(2590, 2865, "gain", "0.25 kg")).toBe("Target = burn 2,590 + 275 to gain 0.25 kg a week.");
    expect(targetLine(2590, 2590, "maintain", "")).toBe("Target = burn 2,590 to keep your weight.");
  });
});

/** A reading of `days` days from `from`, eating 2,200 a day and losing `lost` kg. */
function reading(from: string, to: string, days: number, startKg: number, lost: number, over: Partial<BurnReading> = {}): BurnReading {
  return {
    from, to, days, startKg, endKg: startKg - lost, expectedKg: 0, ateKcal: 2200 * days,
    burn: 2200 + (lost * 7700) / days, loggedShare: 1, bigDayBefore: false, bloated: false, sure: true, ...over,
  };
}

describe("burn readings", () => {
  it("says why a reading is less sure", () => {
    expect(readingNote(reading("2026-11-02", "2026-11-09", 7, 85, 0.5))).toBeNull();
    expect(readingNote(reading("2026-11-09", "2026-11-16", 7, 84.5, 0.5, { loggedShare: 4 / 7, sure: false }))).toBe("4 of 7 days logged");
    expect(readingNote(reading("2026-11-16", "2026-11-23", 7, 84, -0.4, { bigDayBefore: true, bloated: true, sure: false }))).toBe("After a big day");
    expect(readingNote(reading("2026-11-16", "2026-11-23", 7, 84, -0.4, { bloated: true, loggedShare: 3 / 7, sure: false }))).toBe("After a big day · 3 of 7 days logged");
    // A big day that's a weekly habit isn't held against it, and one missing day still leaves it sure.
    expect(readingNote(reading("2026-11-16", "2026-11-23", 7, 84, 0.3, { bigDayBefore: true, loggedShare: 6 / 7 }))).toBeNull();
  });

  it("captions the weigh-ins, the capped move and a burn far from the formula", () => {
    expect(readingsCaption(22, "8 Oct", "regular")).toBe("22 weigh-ins since 8 Oct");
    expect(readingsCaption(3, "28 Sept", "sparse")).toBe("3 weigh-ins since 28 Sept · last 8 weeks");
    expect(capPercent("sparse")).toBe(3);
    expect(capPercent(undefined)).toBe(5);
    const step: RecalculateStep = { prior: 3050, measured: 2880, measuredSd: 210, burn: 2900, gain: 0.9, cap: 153, capped: true };
    expect(moveCaption(step, "regular")).toBe("Moved 150 of 170 kcal: a burn moves at most 5% per update. Your next weigh-ins settle the rest.");
    expect(moveCaption(step, "sparse")).toContain("at most 3% per update while weigh-ins are few.");
    expect(moveCaption({ ...step, capped: false, gain: 0.86 }, "regular")).toContain("moved 86% of the way");
    expect(farTitle(0.28)).toBe("Well above the usual for you");
    expect(farTitle(-0.3)).toBe("Well below the usual for you");
    expect(farNote(0.28, 2500)).toBe("Your burn is 28% above what's usual for your size and activity (2,500). That can be right, but check that your logs are complete. The range stays wide until more weigh-ins agree.");
  });
});
