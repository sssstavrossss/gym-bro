import { describe, expect, it } from "vitest";
import { dayShade } from "../src/lib/dayShade";

describe("day shade", () => {
  const today = "2026-11-14";

  it("leaves future, empty, and targetless days unmarked", () => {
    expect(dayShade("2026-11-15", today, false, null, 2000).shade).toBe("future");
    expect(dayShade("2026-11-13", today, false, null, 2000).shade).toBe("none");
    expect(dayShade("2026-11-13", today, true, 100, null).shade).toBe("notarget");
  });

  it("bands a logged day against its own target and marks over separately", () => {
    expect(dayShade("2026-11-13", today, true, 2000, 2000)).toEqual({ shade: "on", over: false });
    expect(dayShade("2026-11-13", today, true, 1900, 2000).shade).toBe("close");
    expect(dayShade("2026-11-13", today, true, 1700, 2000).shade).toBe("off");
    expect(dayShade("2026-11-13", today, true, 1400, 2000).shade).toBe("far");
    expect(dayShade("2026-11-13", today, true, 2300, 2000)).toEqual({ shade: "off", over: true });
  });
});
