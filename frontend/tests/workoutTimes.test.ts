import { describe, expect, it } from "vitest";
import { atLocal, clockTime, localDay, timesLabel, timesProblem, workoutStatus, type DraftWorkout } from "../src/lib/workout";

// Built from the device's own clock, so the tests hold in any time zone.
const at = (hours: number, minutes: number, day = 27) => new Date(2026, 10, day, hours, minutes).toISOString();
const now = Date.parse(at(19, 30));

describe("workout times", () => {
  it("reads and writes the device's clock and calendar", () => {
    expect(clockTime(at(18, 5))).toBe("18:05");
    expect(localDay(at(0, 10))).toBe("2026-11-27");
    expect(atLocal("2026-11-27", "18:05")).toBe(at(18, 5));
    expect(atLocal("2026-11-27", "")).toBeNull();
    expect(atLocal("27.11.2026", "18:05")).toBeNull();
  });

  it("labels the time chip: going, or ended", () => {
    expect(timesLabel({ startedAt: at(18, 5), endedAt: null })).toBe("18:05 – now");
    expect(timesLabel({ startedAt: at(18, 5), endedAt: at(19, 10) })).toBe("18:05 – 19:10");
    expect(timesLabel({ startedAt: null, endedAt: null })).toBe("Now");
  });

  it("keeps times that make sense, and says why when they don't", () => {
    expect(timesProblem(at(18, 5), null, now)).toBeNull();
    expect(timesProblem(at(18, 5), at(19, 10), now)).toBeNull();
    expect(timesProblem(at(20, 0), null, now)).toBe("The start can't be later than now.");
    expect(timesProblem(at(18, 5), at(20, 0), now)).toBe("The end can't be later than now.");
    expect(timesProblem(at(18, 5), at(18, 5), now)).toBe("The end has to come after the start.");
    expect(timesProblem(at(18, 5, 25), at(19, 0), now)).toBe("A workout can last a day at most.");
    expect(timesProblem(at(18, 5, 25), null, now)).toBe("A workout can last a day at most. Set when it ended.");
  });

  it("stops the status clock at an end set by hand", () => {
    const draft: DraftWorkout = { id: "w", date: "2026-11-27", startedAt: at(18, 0), endedAt: null, name: null, exercises: [], restEndsAt: null, restFor: 0 };
    expect(workoutStatus(draft, now)).toBe("1:30:00 · 0 of 0 sets");
    expect(workoutStatus({ ...draft, endedAt: at(19, 0) }, now)).toBe("1:00:00 · 0 of 0 sets");
  });
});
