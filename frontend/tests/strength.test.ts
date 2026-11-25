import { describe, expect, it } from "vitest";
import { changeLine, liftsUp, sparkline } from "../src/lib/strength";

const point = (date: string, estimatedMax: number) => ({ date, estimatedMax, kg: 100, reps: 5 });

describe("strength lines", () => {
  it("says how far a lift moved since its first day in the range, to the half kilo", () => {
    expect(changeLine({ change: 6.17, points: [point("2026-11-15", 123.33), point("2026-11-22", 129.5)] })).toBe("+6 kg since 15 Nov");
    expect(changeLine({ change: -3.34, points: [point("2026-11-02", 66.67), point("2026-11-04", 63.33)] })).toBe("−3.5 kg since 2 Nov");
    expect(changeLine({ change: 0.2, points: [point("2026-11-02", 60), point("2026-11-04", 60.2)] })).toBe("No change since 2 Nov");
    expect(changeLine({ change: null, points: [point("2026-11-02", 60)] })).toBe("Once in this range");
  });

  it("counts lifts that went up, of those done on two days or more", () => {
    expect(liftsUp([{ change: 6 }, { change: -2 }, { change: 0.1 }, { change: null }])).toEqual({ up: 1, of: 3 });
    expect(liftsUp([])).toEqual({ up: 0, of: 0 });
  });
});

describe("sparkline", () => {
  it("runs from the first day to the last, highest at the top, inside a 3-unit margin", () => {
    const line = sparkline([point("a", 100), point("b", 110), point("c", 105)], 96, 32)!;
    expect(line.d).toBe("M3 29 L48 3 L93 16");
    expect([line.x, line.y]).toEqual([93, 16]);
  });

  it("puts one day or a flat line in the middle, and nothing with no days", () => {
    expect(sparkline([point("a", 100)], 96, 32)).toEqual({ d: "M93 16", x: 93, y: 16 });
    expect(sparkline([point("a", 100), point("b", 100)], 96, 32)!.d).toBe("M3 16 L93 16");
    expect(sparkline([], 96, 32)).toBeNull();
  });
});
