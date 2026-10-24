import { describe, expect, it } from "vitest";
import { calculateTargets } from "../src/lib/nutrition";

const example = {
  sex: "male" as const,
  weightKg: 83.6,
  heightCm: 180,
  age: 36,
  activity: "moderate" as const,
  goal: "lose" as const,
  rateKgPerWeek: 0.5,
  proteinGramsPerKg: 2,
  fatPercent: 25,
};

describe("calculateTargets", () => {
  it("matches the worked example", () => {
    const result = calculateTargets(example);
    expect(result).toMatchObject({ bmr: 1786, tdee: 2768, kcal: 2218, protein: 167, fat: 62, carbs: 249, floored: false });
  });

  it("raises a target that would fall below BMR", () => {
    const result = calculateTargets({ ...example, rateKgPerWeek: 1 });
    expect(result.floored).toBe(true);
    expect(result.kcal).toBe(result.bmr);
    expect(result.bmr).toBe(1786);
  });

  it("never lets carbs go below zero", () => {
    const result = calculateTargets({
      sex: "female",
      weightKg: 45,
      heightCm: 150,
      age: 80,
      activity: "sedentary",
      goal: "lose",
      rateKgPerWeek: 1,
      proteinGramsPerKg: 3,
      fatPercent: 40,
    });
    expect(result.floored).toBe(true);
    expect(result.carbs).toBe(0);
  });

  it("rounds a half kilocalorie away from zero", () => {
    const result = calculateTargets({
      sex: "male",
      weightKg: 80,
      heightCm: 182,
      age: 30,
      activity: "sedentary",
      goal: "maintain",
      rateKgPerWeek: 0,
      proteinGramsPerKg: 2,
      fatPercent: 25,
    });
    expect(result.bmr).toBe(1793);
    expect(result.tdee).toBe(2152);
    expect(result.kcal).toBe(2152);
  });
});
