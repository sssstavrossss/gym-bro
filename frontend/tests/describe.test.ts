import { describe, expect, it } from "vitest";
import type { DescribeItem, FoodSearchRow } from "../src/api";
import { addLabel, chosenRows, loggedItems, recentLine, reviewTitle, rowsFrom, searchSeed, whenLabel } from "../src/lib/describe";

const egg: FoodSearchRow = {
  id: "egg",
  source: "mvt",
  name: "Egg, kokt",
  nameEn: "Egg, boiled",
  basis: "g",
  nutrientBasis: "per_100",
  kcalPer100: 148,
  proteinPer100: 12.9,
  fatPer100: 10.5,
  carbsPer100: 0.3,
  servingQuantity: null,
  servingLabel: null,
  pieceQuantity: 60,
  pieceLabel: "egg",
};

const butter: FoodSearchRow = { ...egg, id: "butter", name: "Smør", nameEn: "Butter", kcalPer100: 744, proteinPer100: 1, fatPer100: 82, carbsPer100: 0.5, pieceQuantity: null, pieceLabel: null };

const items: DescribeItem[] = [
  { phrase: "2 eggs", name: "boiled egg", guessed: false, food: egg, amount: 2, unit: "piece" },
  { phrase: "with butter", name: "butter", guessed: true, food: butter, amount: 10, unit: "g" },
  { phrase: "mum's lasagne", name: "lasagne", guessed: true, food: null, amount: 0, unit: "" },
];

let next = 0;
const keys = () => `k${++next}`;

describe("describe a meal", () => {
  it("checks every matched row and none that didn't match", () => {
    const rows = rowsFrom(items, keys);
    expect(rows.map((row) => row.on)).toEqual([true, true, false]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(chosenRows(rows).map((row) => row.food.id)).toEqual(["egg", "butter"]);
  });

  it("titles the list by what was found", () => {
    const rows = rowsFrom(items, keys);
    expect(reviewTitle(rows)).toBe("2 of 3 found");
    expect(reviewTitle(rows.slice(0, 2))).toBe("2 foods");
    expect(reviewTitle(rows.slice(0, 1))).toBe("1 food");
  });

  it("counts only checked rows on the Add button", () => {
    const rows = rowsFrom(items, keys);
    // 2 eggs = 120 g = 177.6 kcal; 10 g butter = 74.4 kcal.
    expect(addLabel(rows)).toBe("Add 2 foods · 252 kcal");
    rows[1].on = false;
    expect(addLabel(rows)).toBe("Add 1 food · 178 kcal");
    rows[0].on = false;
    expect(addLabel(rows)).toBe("Add");
  });

  it("says when a recent description was logged", () => {
    const today = "2026-11-20";
    expect(whenLabel("2026-11-20T07:30:00Z", today, "Europe/Oslo")).toBe("today");
    expect(whenLabel("2026-11-19T23:30:00Z", today, "Europe/Oslo")).toBe("today");
    expect(whenLabel("2026-11-19T12:00:00Z", today, "Europe/Oslo")).toBe("yesterday");
    expect(whenLabel("2026-11-16T12:00:00Z", today, "Europe/Oslo")).toBe("Mon");
    expect(whenLabel("2026-11-01T12:00:00Z", today, "Europe/Oslo")).toBe("1 Nov");
    expect(whenLabel("not a date", today, "Europe/Oslo")).toBe("");
    expect(recentLine({ foods: 3, kcal: 411.6, loggedAt: "2026-11-19T12:00:00Z" }, today, "Europe/Oslo")).toBe("3 foods · 412 kcal · yesterday");
  });

  it("keeps the logged amounts for next time", () => {
    const rows = rowsFrom(items, keys);
    rows[0].amount = 3;
    expect(loggedItems(chosenRows(rows))).toEqual([
      { phrase: "2 eggs", name: "boiled egg", guessed: false, foodId: "egg", amount: 3, unit: "piece" },
      { phrase: "with butter", name: "butter", guessed: true, foodId: "butter", amount: 10, unit: "g" },
    ]);
  });

  it("searches by Claude's name for a food, or the words typed", () => {
    expect(searchSeed({ name: "lasagne", phrase: "mum's lasagne" })).toBe("lasagne");
    expect(searchSeed({ name: " ", phrase: "mum's lasagne" })).toBe("mum's lasagne");
  });
});
