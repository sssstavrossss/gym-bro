import { expect, it } from "vitest";
import { isManualTarget } from "../src/lib/manualTarget";

it("marks a day only when the stored target says it is a manual number", () => {
  expect(isManualTarget(null)).toBe(false);
  expect(isManualTarget([])).toBe(false);
  expect(isManualTarget(["profile_change"])).toBe(false);
  expect(isManualTarget(["weekly_recalculation", "fresh_start"])).toBe(false);
  expect(isManualTarget(["profile_change", "manual_changed"])).toBe(true);
  expect(isManualTarget(["mode_switch"])).toBe(true);
});
