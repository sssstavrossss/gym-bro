import { describe, expect, it } from "vitest";
import type { TargetHistoryRow } from "../src/api";
import { changeChip, changeLabel, detailRows, historyFar, historyItems, historySub, historyTitle, type HistoryUnits } from "../src/lib/targetHistory";

const units: HistoryUnits = {
  weight: (kg) => String(kg),
  weightSigned: (kg) => (kg < 0 ? `−${Math.abs(kg)}` : `+${kg}`),
  weightUnit: "kg",
  height: (cm) => `${cm} cm`,
};

function row(over: Partial<TargetHistoryRow>): TargetHistoryRow {
  return {
    kind: "target", date: "2026-11-17", kcal: 2040, suggestedKcal: null, protein: 167, fat: 57, carbs: 215,
    burn: 2590, previousKcal: 2234, previousBurn: 2784, weightKg: 83.6, reasons: ["recalculation_adaptive"],
    floorApplied: false, recalculation: null, changes: null, periodFrom: null, periodTo: null,
    ...over,
  };
}

describe("history rows", () => {
  it("titles and explains each kind", () => {
    expect(historyTitle(row({}))).toBe("Recalculated");
    expect(historySub(row({}), units)).toBe("Burn 2,784 → 2,590");
    expect(historySub(row({ reasons: ["recalculation_kept"], burn: 2784 }), units)).toBe("Burn kept at 2,784");
    expect(historySub(row({ reasons: ["recalculation_formula"], burn: 2768 }), units)).toBe("From the formula · burn 2,768");

    const setup = row({ reasons: ["profile_change"], previousKcal: null, previousBurn: null, burn: 2784, kcal: 2234 });
    expect(historyTitle(setup)).toBe("Set up");
    expect(historySub(setup, units)).toBe("Formula · burn 2,784");

    const declined = row({ kind: "declined", reasons: ["recalculation_declined"], kcal: 2234, suggestedKcal: 2120 });
    expect(historyTitle(declined)).toBe("Declined");
    expect(historySub(declined, units)).toBe("Suggested 2,120 · kept 2,234");
    expect(changeChip(declined)).toBeNull();
  });

  it("names a profile change with its units", () => {
    const change = row({ reasons: ["profile_change"], kcal: 2234, changes: [{ field: "goalWeightKg", from: "80", to: "78" }] });
    expect(historyTitle(change)).toBe("Profile change");
    expect(historySub(change, units)).toBe("Goal weight 80 → 78 kg");
    expect(changeChip(change)).toBeNull();
    expect(changeLabel({ field: "activity", from: "moderate", to: "very_active" }, units)).toBe("Activity Moderate → Very active");
    expect(changeLabel({ field: "rateKgPerWeek", from: "0.5", to: "0.25" }, units)).toBe("Rate 0.5 → 0.25 kg/wk");
    expect(changeLabel({ field: "heightCm", from: "180", to: "181" }, units)).toBe("Height 180 cm → 181 cm");
    expect(changeLabel({ field: "fatPercent", from: "25", to: "30" }, units)).toBe("Fat 25 → 30%");
  });

  it("shows the change against the row before", () => {
    expect(changeChip(row({}))).toBe("−194");
    expect(changeChip(row({ kcal: 2300 }))).toBe("+66");
    expect(changeChip(row({ previousKcal: null }))).toBeNull();
  });

  it("lists a recalculation's saved details", () => {
    const saved = row({
      recalculation: {
        from: "2026-10-27", to: "2026-11-16", periodDays: 21, countedDays: 18, lowDays: 3, lowCounted: 0, measured: true,
        weighIns: 12, rateKgPerWeek: -0.49, averageKcal: 2018, measuredBurn: 2558, measuredSd: 146, priorBurn: 2784, stepPercent: 86,
      },
    });
    expect(detailRows(saved, units)).toEqual([
      ["Period", "27 Oct – 16 Nov"],
      ["Days counted", "18 of 21 · 3 low left out"],
      ["Weight", "−0.49 kg a week"],
      ["Weigh-ins", "12"],
      ["Ate", "2,018 a day"],
      ["Measured burn", "2,558 ± 146"],
      ["Moved", "86% of the way"],
      ["Macros", "P167 · F57 · C215"],
    ]);
    expect(detailRows(row({}), units)).toEqual([]);
  });

  it("explains a recalculation saved from the rolling readings", () => {
    const base = {
      from: "2026-11-16", to: "2026-11-22", periodDays: 7, countedDays: 7, lowDays: 0, lowCounted: 0, measured: true,
      weighIns: 8, rateKgPerWeek: -0.4, averageKcal: 2214, measuredBurn: 2880, measuredSd: 210, priorBurn: 3050, stepPercent: 90,
      readings: 7, lessSure: 1, tier: "regular" as const, burn: 2900, burnSd: 210, capKcal: 153, capped: true, formulaBurn: 2500, far: false,
    };
    const capped = row({ burn: 2900, previousBurn: 3050, recalculation: base });
    expect(historySub(capped, units)).toBe("Burn 2,900 · moved 150 of 170 (5% cap)");
    expect(historyFar(capped)).toBeNull();
    expect(detailRows(capped, units)).toEqual([
      ["Period", "16 – 22 Nov"],
      ["Days counted", "7 of 7"],
      ["Weigh-ins", "8 · 1 less sure"],
      ["Ate", "2,214 a day"],
      ["Readings point to", "2,880 ± 210"],
      ["Burn", "3,050 → 2,900"],
      ["Range", "2,690–3,110"],
      ["Usual for you", "2,500"],
      ["Macros", "P167 · F57 · C215"],
    ]);

    const far = row({ burn: 3200, recalculation: { ...base, measuredBurn: 3330, measuredSd: 300, burn: 3200, burnSd: 400, lessSure: 0, far: true } });
    expect(historyFar(far)).toBeCloseTo(0.28, 6);
    expect(historySub(far, units)).toBe("Burn 3,200 · well above usual");
    const rows = detailRows(far, units);
    expect(rows).toContainEqual(["Weigh-ins", "8 · all sure"]);
    expect(rows).toContainEqual(["Range", "2,800–3,600 (wide)"]);
    expect(rows).toContainEqual(["Usual for you", "2,500 · burn 28% above"]);

    // Not capped: the plain move.
    expect(historySub(row({ burn: 2990, previousBurn: 3050, recalculation: { ...base, burn: 2990, capped: false } }), units)).toBe("Burn 3,050 → 2,990");
  });
});

describe("history list", () => {
  it("labels months and folds declines in a row", () => {
    const declined = (date: string) => row({ kind: "declined", date, reasons: ["recalculation_declined"], suggestedKcal: 2120, kcal: 2234 });
    const items = historyItems([
      row({ date: "2026-11-17" }),
      declined("2026-11-03"),
      declined("2026-10-27"),
      declined("2026-10-20"),
      row({ date: "2026-10-13", reasons: ["profile_change"] }),
      declined("2026-10-06"),
      row({ date: "2026-09-29", previousKcal: null }),
    ]);
    expect(items.map((item) => item.kind === "month" ? item.label : item.kind === "declines" ? item.label : item.row.date)).toEqual([
      "November 2026",
      "2026-11-17",
      "Declined 3 times · 20 Oct – 3 Nov",
      "October 2026",
      "2026-10-13",
      "2026-10-06",
      "September 2026",
      "2026-09-29",
    ]);
  });
});
