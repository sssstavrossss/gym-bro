import { describe, expect, it } from "vitest";
import { lastWorkout, repeatName, startText, trainCards, weekDiscs, type TrainInput } from "../src/lib/train";
import { startingSets } from "../src/lib/workout";

const first: TrainInput = { active: false, planState: "ready", hasPlan: false, historyState: "ready", historyRows: 0, waiting: 0 };

describe("trainCards", () => {
  it("shows a first visit the plan, the start, the library and the history prompt, but no History", () => {
    expect(trainCards(first)).toEqual({ inProgress: false, start: true, makePlan: true, explore: true, trainedBefore: true, history: false });
  });

  it("shows History once there is a workout, saved or waiting to send", () => {
    expect(trainCards({ ...first, historyRows: 3 })).toMatchObject({ history: true, trainedBefore: false });
    expect(trainCards({ ...first, waiting: 1 })).toMatchObject({ history: true, trainedBefore: false });
  });

  it("shows neither History nor the prompt while history loads, so nothing jumps", () => {
    for (const historyState of ["idle", "loading"] as const) {
      expect(trainCards({ ...first, historyState })).toMatchObject({ history: false, trainedBefore: false });
    }
    // A finished workout waiting to send shows straight away.
    expect(trainCards({ ...first, historyState: "loading", waiting: 1 })).toMatchObject({ history: true });
  });

  it("keeps History up when it fails to load, to say so", () => {
    expect(trainCards({ ...first, historyState: "failed" })).toMatchObject({ history: true, trainedBefore: false });
  });

  it("drops Make a plan and Explore with a plan, or until the plan has loaded", () => {
    expect(trainCards({ ...first, hasPlan: true })).toMatchObject({ makePlan: false, explore: false });
    expect(trainCards({ ...first, planState: "loading" })).toMatchObject({ makePlan: false, explore: false });
    expect(trainCards({ ...first, planState: "failed" })).toMatchObject({ makePlan: false, explore: false });
  });

  it("swaps the start for the workout in progress", () => {
    expect(trainCards({ ...first, active: true })).toMatchObject({ inProgress: true, start: false });
  });
});

describe("startText", () => {
  it("names the card by whether there is a plan, and offers Describe only when it works", () => {
    expect(startText(false, true)).toEqual({ title: "Quick add", caption: "Add exercises as you go, or describe it" });
    expect(startText(false, false).caption).toBe("Add exercises as you go and tick off each set");
    expect(startText(true, true)).toEqual({ title: "Quick add", caption: "Off the plan: add exercises as you go, or describe it" });
    expect(startText(true, false).caption).toBe("Off the plan: add exercises as you go");
  });

  it("offers the last workout again when there is one", () => {
    expect(startText(true, true, { name: "Lower B", exercises: ["barbell-squat"] }).caption).toBe("Empty, describe it, or repeat Lower B");
    expect(startText(false, false, { name: null, exercises: ["plank"] })).toEqual({ title: "Quick add", caption: "Empty, or repeat your last workout" });
  });
});

describe("lastWorkout", () => {
  const row = (name: string | null, status: string, exercises: string[]) => ({ name, status, exercises });
  const draft = (name: string | null, ids: string[], skipped?: boolean) => ({ name, exercises: ids.map((exerciseId) => ({ exerciseId })), skipped });

  it("takes the newest done workout, skipping skips and empty ones", () => {
    expect(lastWorkout([], [row("Upper A", "skipped", []), row(null, "done", []), row("Lower B", "done", ["barbell-squat", "plank"]), row("Upper B", "done", ["pullups"])]))
      .toEqual({ name: "Lower B", exercises: ["barbell-squat", "plank"] });
    expect(lastWorkout([], [])).toBeNull();
  });

  it("prefers a finished workout still waiting to send, the newest one, each exercise once", () => {
    const pending = [draft("Old", ["plank"]), draft(null, ["run", "run", "plank"]), draft("Skip", [], true)];
    expect(lastWorkout(pending, [row("Lower B", "done", ["barbell-squat"])])).toEqual({ name: null, exercises: ["run", "plank"] });
  });

  it("names an unnamed workout for the button", () => {
    expect(repeatName({ name: null, exercises: ["plank"] })).toBe("your last workout");
    expect(repeatName({ name: "Leg day", exercises: ["plank"] })).toBe("Leg day");
  });
});

describe("weekDiscs", () => {
  // Thursday 26 November 2026: the week is Mon 23 to Sun 29.
  const today = "2026-11-26";
  const coming = [{ date: "2026-11-26", workout: { name: "Upper A" } }, { date: "2026-11-28", workout: { name: "Lower A" } }, { date: "2026-11-30", workout: { name: "Upper B" } }];

  it("runs Monday to Sunday with what each day held or holds", () => {
    const week = weekDiscs(today, coming, ["2026-11-23"], ["2026-11-24"]);
    expect(week.map((day) => day.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.map((day) => day.letter).join("")).toBe("MTWTFSS");
    expect(week.map((day) => day.state)).toEqual(["done", "skipped", "rest", "today", "rest", "planned", "rest"]);
    expect(week[3]).toMatchObject({ number: 26, workout: "Upper A", label: "Thu 26 Nov, Upper A, today" });
    expect(week.map((day) => day.label)).toEqual([
      "Mon 23 Nov, trained", "Tue 24 Nov, skipped", "Wed 25 Nov", "Thu 26 Nov, Upper A, today", "Fri 27 Nov, rest day", "Sat 28 Nov, Lower A", "Sun 29 Nov, rest day",
    ]);
  });

  it("marks today done once a workout is, and a day off as plain today", () => {
    expect(weekDiscs(today, coming.slice(1), [today], [])[3]).toMatchObject({ state: "done", label: "Thu 26 Nov, trained" });
    expect(weekDiscs(today, [], [], [])[3]).toMatchObject({ state: "today", workout: null, label: "Thu 26 Nov, today" });
  });

  it("starts the week on Monday when today is Sunday or Monday", () => {
    expect(weekDiscs("2026-11-29", [], [], [])[0].date).toBe("2026-11-23");
    expect(weekDiscs("2026-11-30", [], [], [])[0].date).toBe("2026-11-30");
  });
});

describe("startingSets", () => {
  it("matches last time's working sets, 1 to 10, else 3 (1 for cardio)", () => {
    const sets = (types: string[]) => ({ sets: types.map((type) => ({ type })) });
    expect(startingSets(sets(["warmup", "working", "working"]), false)).toBe(2);
    expect(startingSets(sets(["warmup"]), false)).toBe(1);
    expect(startingSets(sets(Array(14).fill("working")), false)).toBe(10);
    expect(startingSets(null, false)).toBe(3);
    expect(startingSets(undefined, true)).toBe(1);
  });
});
