import { describe, expect, it } from "vitest";
import { cardTitle, fourWeekTotals, kcalLine, kindOf, savedLine, trainingByDay, trainingSaid, type SavedWorkout } from "../src/lib/trainingDays";

const row = (over: Partial<SavedWorkout>): SavedWorkout => ({
  id: "w1", date: "2026-11-23", kind: "strength", name: "Upper A", status: "done",
  startedAt: "2026-11-23T17:00:00Z", endedAt: "2026-11-23T17:54:00Z", sets: 18, ...over,
});

describe("kindOf", () => {
  it("keeps a known kind and reads anything else as strength", () => {
    expect(kindOf("cardio")).toBe("cardio");
    expect(kindOf("sport")).toBe("sport");
    expect(kindOf("swimming")).toBe("strength");
    expect(kindOf(null)).toBe("strength");
  });
});

describe("savedLine", () => {
  it("gives minutes and sets, distance first when it covered any, and Skipped", () => {
    expect(savedLine(row({}))).toBe("54 min · 18 sets");
    expect(savedLine(row({ sets: 1 }))).toBe("54 min · 1 set");
    expect(savedLine(row({ kind: "cardio", metres: 5200, sets: 1 }))).toBe("5.2 km · 54 min");
    expect(savedLine(row({ startedAt: null, endedAt: null }))).toBe("18 sets");
    expect(savedLine(row({ startedAt: null, endedAt: null, sets: 0 }))).toBe("Done");
    expect(savedLine(row({ status: "skipped" }))).toBe("Skipped");
  });
});

describe("trainingByDay", () => {
  const coming = [
    { date: "2026-11-27", workout: { id: "pa", name: "Upper A", minutes: 55 } },
    { date: "2026-11-29", workout: { id: "pb", name: "Stations A", minutes: 45 } },
  ];

  it("puts saved, waiting and planned workouts on their days, done before skipped", () => {
    const days = trainingByDay(
      [row({}), row({ id: "w2", date: "2026-11-26", kind: "cardio", name: "Run", status: "skipped" }), row({ id: "w3", kind: "mobility", name: "Mobility", status: "skipped" })],
      [{ id: "d1", date: "2026-11-25", name: "Stations A", plan: { workoutId: "pb" } }],
      coming,
      { pa: "strength", pb: "hybrid" },
    );
    expect(days["2026-11-23"].map((item) => [item.state, item.kind])).toEqual([["done", "strength"], ["skipped", "mobility"]]);
    expect(days["2026-11-26"][0]).toEqual({ state: "skipped", kind: "cardio", name: "Run", line: "Skipped" });
    expect(days["2026-11-25"][0]).toEqual({ state: "done", kind: "hybrid", name: "Stations A", line: "Waiting to send" });
    expect(days["2026-11-27"][0]).toEqual({ state: "planned", kind: "strength", name: "Upper A", line: "Planned · about 55 min" });
    expect(days["2026-11-29"][0].kind).toBe("hybrid");
    expect(days["2026-11-24"]).toBeUndefined();
  });

  it("drops a waiting copy once it's saved, and a planned day that already has a workout", () => {
    const days = trainingByDay([row({ date: "2026-11-27" })], [{ id: "w1", date: "2026-11-27", name: "Upper A" }], coming, undefined);
    expect(days["2026-11-27"]).toHaveLength(1);
    expect(days["2026-11-27"][0].state).toBe("done");
    // An older server sends no kinds: planned days read as strength.
    expect(days["2026-11-29"][0].kind).toBe("strength");
  });
});

describe("trainingSaid", () => {
  it("adds each workout and its state to a day's name", () => {
    expect(trainingSaid(undefined)).toBe("");
    expect(trainingSaid([{ state: "done", kind: "cardio", name: "Run", line: "" }, { state: "planned", kind: "strength", name: "Upper A", line: "" }]))
      .toBe(", Run done, Upper A planned");
  });
});

describe("kcalLine", () => {
  const today = "2026-11-27";
  it("reads on target within 5% (the tile's tick), else how far over or under", () => {
    expect(kcalLine("2026-11-21", today, true, 2197, 2100)).toBe("2,197 kcal · on target");
    expect(kcalLine("2026-11-21", today, true, 2280, 2100)).toBe("2,280 kcal · 180 over");
    expect(kcalLine("2026-11-19", today, true, 2340, 2100)).toBe("2,340 kcal · 240 over");
    expect(kcalLine("2026-11-19", today, true, 1700, 2100)).toBe("1,700 kcal · 400 under");
    expect(kcalLine("2026-11-19", today, true, 1700, null)).toBe("1,700 kcal");
  });
  it("says when nothing was logged, and what a coming day has", () => {
    expect(kcalLine("2026-11-19", today, false, null, 2100)).toBe("Nothing logged");
    expect(kcalLine("2026-11-28", today, true, null, null)).toBe("Food planned");
    expect(kcalLine("2026-11-28", today, false, null, null)).toBe("Nothing planned");
  });
});

describe("cardTitle", () => {
  it("names the days around today, and dates the rest", () => {
    expect(cardTitle("2026-11-27", "2026-11-27")).toBe("Today");
    expect(cardTitle("2026-11-26", "2026-11-27")).toBe("Yesterday");
    expect(cardTitle("2026-11-28", "2026-11-27")).toBe("Tomorrow");
    expect(cardTitle("2026-11-21", "2026-11-27")).toBe("Sat 21 Nov");
  });
});

describe("fourWeekTotals", () => {
  it("counts up to today: on target and weigh-ins from setup, workouts from before it too", () => {
    const dates = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"];
    const totals = fourWeekTotals(
      dates, "2026-11-27", "2026-11-24",
      { "2026-11-23": "on", "2026-11-24": "on", "2026-11-25": "close", "2026-11-26": "off" },
      {
        "2026-11-23": [{ state: "done", kind: "strength", name: "", line: "" }],
        "2026-11-25": [{ state: "done", kind: "strength", name: "", line: "" }, { state: "skipped", kind: "cardio", name: "", line: "" }],
        "2026-11-28": [{ state: "planned", kind: "strength", name: "", line: "" }],
      },
      new Set(["2026-11-23", "2026-11-24", "2026-11-27"]),
    );
    expect(totals).toEqual({ onTarget: 2, done: 2, skipped: 1, weighIns: 2, days: 4 });
  });
});
