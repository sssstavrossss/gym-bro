import { describe, expect, it } from "vitest";
import { lastWeighInLine, nudgeBackOn, nudgeDismissed } from "../src/lib/weightDisplay";

describe("the Home weigh-in tip", () => {
  it("says when the last weigh-in was", () => {
    expect(lastWeighInLine("2026-11-25", "2026-11-26")).toBe("Your last weigh-in was yesterday.");
    expect(lastWeighInLine("2026-11-14", "2026-11-26")).toBe("Your last weigh-in was 12 days ago.");
    expect(lastWeighInLine("2026-10-20", "2026-11-26")).toBe("Your last weigh-in was 5 weeks ago.");
    expect(lastWeighInLine("2026-11-26", "2026-11-26")).toBeNull();
    expect(lastWeighInLine(null, "2026-11-26")).toBeNull();
  });

  it("stays hidden for a week after ✕", () => {
    const backOn = nudgeBackOn("2026-11-26");
    expect(backOn).toBe("2026-12-03");
    expect(nudgeDismissed(backOn, "2026-12-02")).toBe(true);
    expect(nudgeDismissed(backOn, "2026-12-03")).toBe(false);
    expect(nudgeDismissed(null, "2026-11-26")).toBe(false);
  });
});
