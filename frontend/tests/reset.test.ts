import { describe, expect, it } from "vitest";
import { confirmLine, doneLine, hasNutrition, hasTraining, logLine, ownLine, trainingLine, type ResetSummary } from "../src/lib/reset";

const summary: ResetSummary = {
  training: { workouts: 24, plan: { goal: "muscle", split: "upper_lower" } },
  nutrition: { entries: 1284, days: 96, foods: 12, recipes: 5, groups: 1 },
};

describe("reset data", () => {
  it("says what is there", () => {
    expect(trainingLine(summary.training)).toBe("24 workouts · Muscle plan");
    expect(trainingLine({ workouts: 1, plan: null })).toBe("1 workout");
    expect(trainingLine({ workouts: 0, plan: null })).toBe("Nothing yet");
    expect(logLine(summary.nutrition)).toBe("1,284 entries over 96 days");
    expect(logLine({ ...summary.nutrition, entries: 1, days: 1 })).toBe("1 entry over 1 day");
    expect(logLine({ ...summary.nutrition, entries: 0 })).toBe("Nothing logged");
    expect(ownLine(summary.nutrition)).toBe("12 foods · 5 recipes · 1 group");
  });

  it("knows when there is nothing to reset", () => {
    expect(hasTraining(summary.training)).toBe(true);
    expect(hasTraining({ workouts: 0, plan: null })).toBe(false);
    const empty = { entries: 0, days: 0, foods: 2, recipes: 0, groups: 0 };
    expect(hasNutrition(empty, false)).toBe(false);
    expect(hasNutrition(empty, true)).toBe(true);
  });

  it("says what goes and what stays", () => {
    expect(confirmLine("training", summary)).toBe("24 workouts with their sets, your plan and any workout going on this phone are deleted. Your food log, weigh-ins and targets stay. This can't be undone.");
    expect(confirmLine("nutrition", { ...summary, nutrition: { ...summary.nutrition, entries: 0 } })).toBe("Your closed and fasting days are deleted. Your workouts, weigh-ins and targets stay. This can't be undone.");
    expect(confirmLine("nutrition", summary)).toBe("1,284 log entries are deleted. Your workouts, weigh-ins and targets stay. This can't be undone.");
    expect(confirmLine("nutrition", summary, true)).toBe("1,284 log entries and your foods, recipes and groups are deleted. Your workouts, weigh-ins and targets stay. This can't be undone.");
  });

  it("says what was deleted", () => {
    expect(doneLine("training", { workouts: 24 })).toBe("Training reset · 24 workouts deleted");
    expect(doneLine("nutrition", { entries: 1284, foods: 0 })).toBe("Nutrition reset · 1,284 entries deleted");
    expect(doneLine("nutrition", { entries: 3, foods: 2, recipes: 1, groups: 0 })).toBe("Nutrition reset · 3 entries and 3 foods, recipes and groups deleted");
  });
});
