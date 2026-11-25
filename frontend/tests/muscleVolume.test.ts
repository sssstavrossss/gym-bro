import { describe, expect, it } from "vitest";
import { mapTones, notYet, setsText, targetLine, volumeLine, volumeStatus } from "../src/lib/muscleVolume";

const target = { low: 10, high: 14 };

describe("sets per muscle this week", () => {
  it("is under below the low end, on target through the high end, then over", () => {
    expect(volumeStatus(9.5, target)).toBe("under");
    expect(volumeStatus(10, target)).toBe("on");
    expect(volumeStatus(14, target)).toBe("on");
    expect(volumeStatus(14.5, target)).toBe("over");
  });

  it("says how far off the target a muscle is and on how many days", () => {
    expect(volumeLine({ sets: 7.5, days: 1 }, target)).toBe("2.5 to go · 1 day");
    expect(volumeLine({ sets: 12, days: 2 }, target)).toBe("On target · 2 days");
    expect(volumeLine({ sets: 18, days: 3 }, target)).toBe("4 over · 3 days");
    expect(volumeLine({ sets: 1.5, days: 0 }, target)).toBe("8.5 to go · helping only");
    expect(setsText(1)).toBe("1 set");
    expect(setsText(7.5)).toBe("7.5 sets");
  });

  it("shades the map by target and names the big muscles not worked yet", () => {
    expect(mapTones([{ muscle: "quadriceps", sets: 12 }, { muscle: "glutes", sets: 3 }, { muscle: "calves", sets: 0 }], target))
      .toEqual({ primary: ["quadriceps"], secondary: ["glutes"] });
    const most = ["chest", "lats", "middle-back", "shoulders", "biceps", "quadriceps", "hamstrings", "glutes", "calves"].map((muscle) => ({ muscle }));
    expect(notYet(most)).toBe("Triceps and Abdominals");
    expect(notYet([...most, { muscle: "triceps" }])).toBe("Abdominals");
    expect(notYet([...most, { muscle: "triceps" }, { muscle: "abdominals" }])).toBe("");
  });

  it("says where the target comes from", () => {
    expect(targetLine({ low: 8, high: 10 }, "new")).toBe("Aim for 8–10 sets a muscle (new)");
    expect(targetLine(target, null)).toBe("Aim for 10–14 sets a muscle (no plan, so some experience)");
  });
});
