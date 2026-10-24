import { describe, expect, it } from "vitest";
import { iso, todayIso } from "../src/lib/dates";

describe("todayIso", () => {
  it("is the real local date", () => {
    expect(todayIso()).toBe(iso(new Date()));
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
