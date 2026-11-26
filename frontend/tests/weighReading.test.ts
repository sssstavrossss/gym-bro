import { describe, expect, it } from "vitest";
import type { WeighInExpectation } from "../src/api";
import { expectedGap, expectedNote, expectedTitle } from "../src/lib/weighReading";

// 2026-11-26 is a Thursday.
const today = "2026-11-26";
const base: WeighInExpectation = {
  date: today, from: "2026-11-19", days: 7, startKg: 84.1, expectedKg: 83.62, ateKcal: 15600, loggedDays: 7,
  burn: 2926, bigDay: null, habit: false, sure: true,
};

describe("weigh-in expectation", () => {
  it("shows the expected weight and how far a typed one is from it", () => {
    expect(expectedTitle(base, "kg")).toBe("Expected about 83.6 kg");
    expect(expectedGap(base, 84.12, "kg")).toBe("+0.5 kg");
    expect(expectedGap(base, 83.3, "kg")).toBe("−0.3 kg");
    expect(expectedGap(base, 83.63, "kg")).toBe("as expected");
    expect(expectedGap(base, null, "kg")).toBeNull();
    expect(expectedTitle(base, "lb")).toBe("Expected about 184.4 lb");
  });

  it("says where it comes from, by weekday within a week and by date before", () => {
    expect(expectedNote(base, today)).toBe("From your food since 19 Nov and your burn of 2,926 kcal.");
    expect(expectedNote({ ...base, from: "2026-11-23", days: 3, loggedDays: 3 }, today))
      .toBe("From your food since Monday and your burn of 2,926 kcal.");
    expect(expectedNote({ ...base, from: "2026-11-25", days: 1, loggedDays: 1 }, today))
      .toBe("From your food since yesterday and your burn of 2,926 kcal.");
  });

  it("explains an odd big day and missing logs, and that the weigh-in counts for less", () => {
    const feast = { ...base, date: "2026-11-23", from: "2026-11-20", days: 3, loggedDays: 3, bigDay: { date: "2026-11-22", kcal: 3500, targetKcal: 2500 }, sure: false };
    expect(expectedNote(feast, "2026-11-23")).toBe(
      "From your food since Friday and your burn of 2,926 kcal. Yesterday was a big day (140% of target), so some of it is likely water. This weigh-in counts less toward your burn.",
    );
    expect(expectedNote({ ...feast, from: "2026-11-20", days: 6, loggedDays: 6, bigDay: { date: "2026-11-25", kcal: 3500, targetKcal: 2500 } }, today)).toBe(
      "From your food since Friday and your burn of 2,926 kcal. Yesterday was a big day (140% of target), so some of it is likely water. This weigh-in counts less toward your burn.",
    );
    expect(expectedNote({ ...feast, from: "2026-11-23", bigDay: { date: "2026-11-25", kcal: 3500, targetKcal: 2500 }, habit: true, sure: true }, today))
      .toBe("From your food since Monday and your burn of 2,926 kcal. Yesterday was a big day, as usual before a weigh-in, so it evens out.");
    expect(expectedNote({ ...base, loggedDays: 3, sure: false }, today)).toBe(
      "From your food since 19 Nov and your burn of 2,926 kcal. 4 unlogged days count as usual. This weigh-in counts less toward your burn.",
    );
    expect(expectedNote({ ...base, from: "2026-11-23", days: 3, loggedDays: 2 }, today)).toContain("1 unlogged day counts as usual.");
  });
});
