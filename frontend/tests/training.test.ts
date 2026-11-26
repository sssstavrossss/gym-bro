import { describe, expect, it } from "vitest";
import { defaultAnswers, type Plan } from "../src/lib/plan";
import { sameTraining, trainingFrom, trainingOf, usingLine, withTraining, type TrainingSettings } from "../src/lib/training";

const mine: TrainingSettings = { minutes: 45, experience: "new", equipment: ["kettlebells", "dumbbells"], goEasy: ["knees", "shoulders"], warmUp: true, coolDown: false };

describe("Your training", () => {
  it("keeps the lists in the setup's order", () => {
    expect(trainingFrom(mine)).toEqual({ ...mine, equipment: ["dumbbells", "kettlebells"], goEasy: ["shoulders", "knees"] });
  });

  it("comes from the account, then the plan, then the defaults", () => {
    const plan = { ...defaultAnswers(), minutes: 75, experience: "experienced", equipment: ["home"], goEasy: [], warmUp: undefined, coolDown: true } as unknown as Plan;
    expect(trainingOf(mine, plan).minutes).toBe(45);
    expect(trainingOf(null, plan)).toEqual({ minutes: 75, experience: "experienced", equipment: ["home"], goEasy: [], warmUp: false, coolDown: true });
    expect(trainingOf(undefined, null)).toEqual({ minutes: 60, experience: "some", equipment: ["gym"], goEasy: [], warmUp: false, coolDown: false });
    // Saved with no equipment: a plan needs some, so it falls back.
    expect(trainingOf({ ...mine, equipment: [] }, null).equipment).toEqual(["gym"]);
  });

  it("fills a new plan's answers and leaves the goal and days", () => {
    const answers = withTraining({ ...defaultAnswers(), goal: "strength", weekdays: [1, 3] }, mine);
    expect(answers).toMatchObject({ goal: "strength", weekdays: [1, 3], minutes: 45, experience: "new", equipment: ["dumbbells", "kettlebells"], goEasy: ["shoulders", "knees"], warmUp: true, coolDown: false, easeIn: null, split: null });
  });

  it("says what a plan will use", () => {
    expect(usingLine(trainingOf(null, null))).toBe("Full gym · 60 min · Some experience");
    expect(usingLine(mine)).toBe("Dumbbells, Kettlebells · 45 min · New to training");
  });

  it("compares without caring about order", () => {
    expect(sameTraining(mine, { ...mine, equipment: ["dumbbells", "kettlebells"] })).toBe(true);
    expect(sameTraining(mine, { ...mine, coolDown: true })).toBe(false);
  });
});
