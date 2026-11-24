import { describe, expect, it } from "vitest";
import { sessionKcal, sessionLines, sessionRows, type SessionEntry } from "../src/lib/addSession";

const entry = (id: string, key: string, kcal: number, extra: Partial<SessionEntry> = {}): SessionEntry & { name?: string } =>
  ({ id, idempotencyKey: key, kcal, ...extra });

describe("sessionRows", () => {
  const egg = entry("e1", "k-egg", 149);
  const pear = entry("e2", "k-pear", 88);

  it("lists the newest add first", () => {
    expect(sessionRows([egg, pear], [egg, pear]).map((row) => row.id)).toEqual(["e2", "e1"]);
  });

  it("shows the day's current copy, so an edit shows", () => {
    const edited = { ...pear, kcal: 95 };
    expect(sessionRows([egg, pear], [egg, edited])[0].kcal).toBe(95);
  });

  it("hides a deleted add, and brings it back when the day has it again", () => {
    expect(sessionRows([egg, pear], [egg]).map((row) => row.id)).toEqual(["e1"]);
    expect(sessionRows([egg, pear], [pear, egg]).map((row) => row.id)).toEqual(["e2", "e1"]);
  });

  it("follows a queued add to its server id by the idempotency key", () => {
    const queued = entry("local:k-egg", "k-egg", 149, { queued: "waiting" });
    expect(sessionRows([queued], [egg])).toEqual([egg]);
  });

  it("ignores the day's other entries", () => {
    expect(sessionRows([pear], [entry("x", "k-x", 500), pear])).toEqual([pear]);
  });

  it("uses the entries as added when the day isn't loaded", () => {
    expect(sessionRows([egg, pear], null)).toEqual([pear, egg]);
  });
});

describe("sessionLines", () => {
  const rows = [entry("e2", "b", 88), entry("e1", "a", 149)];

  it("counts the adds over the day's total", () => {
    expect(sessionLines(rows, null, "Today", 975)).toEqual({ title: "2 added · 237 kcal", sub: "Today · 975 kcal" });
  });

  it("counts the selection while selecting, and keeps the adds on the second line", () => {
    expect(sessionLines(rows, ["e1"], "Today", 975)).toEqual({ title: "1 selected · 149 kcal", sub: "2 added · 237 kcal" });
    expect(sessionLines(rows, [], "12 Nov", 975).title).toBe("0 selected · 0 kcal");
  });

  it("counts a refused add as nothing", () => {
    expect(sessionKcal([entry("a", "a", 100), entry("b", "b", 50, { queued: "failed" })])).toBe(100);
  });
});
