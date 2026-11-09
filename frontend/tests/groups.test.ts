import { expect, it } from "vitest";
import {
  canSaveGroup,
  groupAddNeedsTime,
  groupItemLine,
  groupName,
  groupTimeNote,
  matchingGroups,
  readdToast,
} from "../src/lib/groups";

it("names an empty group My group and keeps a typed name", () => {
  expect(groupName("   ")).toBe("My group");
  expect(groupName("  Usual   breakfast ")).toBe("Usual breakfast");
});

it("needs two entries before Save as group is available", () => {
  expect(canSaveGroup(0)).toBe(false);
  expect(canSaveGroup(1)).toBe(false);
  expect(canSaveGroup(2)).toBe(true);
});

it("keeps Add off on a past day until a time is picked", () => {
  expect(groupAddNeedsTime("2026-10-23", "2026-10-24", null)).toBe(true);
  expect(groupAddNeedsTime("2026-10-23", "2026-10-24", "19:40")).toBe(false);
  expect(groupAddNeedsTime("2026-10-24", "2026-10-24", null)).toBe(false);
});

it("filters groups by name or item and describes a row", () => {
  const groups = [
    { name: "Usual breakfast", items: [{ name: "Oats" }, { name: "Yogurt" }] },
    { name: "Shake", items: [{ name: "Milk" }] },
  ];
  expect(matchingGroups(groups, "yogurt").map((group) => group.name)).toEqual(["Usual breakfast"]);
  expect(matchingGroups(groups, "  ")).toHaveLength(2);
  expect(groupItemLine({ amount: 2, unit: "slice", grams: 80, kcal: 140 })).toBe("2 slices · 140 kcal");
  expect(groupItemLine({ amount: 1, unit: "", grams: null, kcal: 123 })).toBe("123 kcal");
});

it("names skipped foods in the re-add notice", () => {
  expect(readdToast("Usual breakfast", 2, 180, "")).toBe("Added Usual breakfast · 2 items · 180 kcal");
  expect(readdToast("Usual breakfast", 2, 180, "Skipped Fictional bar.")).toBe(
    "Added Usual breakfast · 2 items · 180 kcal. Skipped Fictional bar.",
  );
  expect(readdToast("Usual breakfast", 0, 0, "Skipped Fictional bar.")).toBe("Skipped Fictional bar.");
  expect(groupTimeNote(true, true, null)).toBe("at the time you pick");
  expect(groupTimeNote(false, false, null)).toBe("now");
  expect(groupTimeNote(false, true, "19:40")).toBe("at 19:40");
});
