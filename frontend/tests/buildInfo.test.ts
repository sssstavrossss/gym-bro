import { describe, expect, it } from "vitest";
import { buildLabel } from "../src/lib/buildInfo";

describe("build label", () => {
  it("shows the short commit and the build day", () => {
    expect(buildLabel("421f4f3a9c0d", "2026-11-16T14:32:00Z")).toBe("Build 421f4f3 · 16 Nov 2026");
    expect(buildLabel("", "2026-11-16T14:32:00Z")).toBe("Build dev · 16 Nov 2026");
    expect(buildLabel("abc1234", "")).toBe("Build abc1234");
    expect(buildLabel("", "nope")).toBe("Build dev");
  });
});
