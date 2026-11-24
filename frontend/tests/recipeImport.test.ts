import { describe, expect, it } from "vitest";
import type { DescribeItem, FoodSearchRow } from "../src/api";
import { rowsFrom } from "../src/lib/describe";
import { importedNotice, importSource, importTitle, importUseLabel, RECIPE_IMPORT_MAX } from "../src/lib/recipeImport";

const rice: FoodSearchRow = {
  id: "rice",
  source: "mvt",
  name: "Ris, ukokt",
  nameEn: "Rice, uncooked",
  basis: "g",
  nutrientBasis: "per_100",
  kcalPer100: 350,
  proteinPer100: 7,
  fatPer100: 1,
  carbsPer100: 77,
  servingQuantity: null,
  servingLabel: null,
  pieceQuantity: null,
  pieceLabel: null,
};

const chicken: FoodSearchRow = { ...rice, id: "chicken", name: "Kylling, rå", nameEn: "Chicken, raw", kcalPer100: 110 };

const items: DescribeItem[] = [
  { phrase: "400 g kylling", name: "chicken", guessed: false, food: chicken, amount: 400, unit: "g" },
  { phrase: "3 dl ris", name: "rice", guessed: false, food: rice, amount: 240, unit: "g" },
  { phrase: "1 klype safran", name: "saffron", guessed: true, food: null, amount: 0, unit: "" },
];

let next = 0;
const keys = () => `k${++next}`;

describe("recipe import", () => {
  it("reads one link on its own as a link, and anything else as ingredients", () => {
    expect(importSource("  https://www.matprat.no/oppskrifter/kos/pasta/  ")).toEqual({ url: "https://www.matprat.no/oppskrifter/kos/pasta/" });
    expect(importSource("http://example.com")).toEqual({ url: "http://example.com/" });
    expect(importSource("https://example.com/a\n200 g pasta")).toEqual({ text: "https://example.com/a\n200 g pasta" });
    expect(importSource("see https://example.com")).toEqual({ text: "see https://example.com" });
    expect(importSource("ftp://example.com/x")).toEqual({ text: "ftp://example.com/x" });
    expect(importSource("400 g kylling\n3 dl ris")).toEqual({ text: "400 g kylling\n3 dl ris" });
    expect(importSource("   \n ")).toBeNull();
    expect(importSource("a".repeat(RECIPE_IMPORT_MAX + 50))).toEqual({ text: "a".repeat(RECIPE_IMPORT_MAX) });
  });

  it("titles the list by ingredients, and says how many matched", () => {
    const rows = rowsFrom(items, keys);
    expect(importTitle(rows)).toBe("2 of 3 found");
    expect(importTitle(rows.slice(0, 2))).toBe("2 ingredients");
    expect(importTitle(rows.slice(0, 1))).toBe("1 ingredient");
  });

  it("counts only checked, matched rows on the Use button", () => {
    const rows = rowsFrom(items, keys);
    // 400 g chicken = 440 kcal; 240 g rice = 840 kcal.
    expect(importUseLabel(rows)).toBe("Use 2 ingredients · 1,280 kcal");
    rows[0].on = false;
    expect(importUseLabel(rows)).toBe("Use 1 ingredient · 840 kcal");
    rows[1].on = false;
    expect(importUseLabel(rows)).toBe("Use");
  });

  it("says where the recipe came from and what was left out", () => {
    expect(importedNotice("matprat.no", 8, 1)).toBe("Imported from matprat.no. 1 ingredient wasn't added. Check the amounts before you save.");
    expect(importedNotice("matprat.no", 9, 0)).toBe("Imported from matprat.no. Check the amounts before you save.");
    expect(importedNotice(null, 5, 2)).toBe("Imported 5 ingredients. 2 ingredients weren't added. Check the amounts before you save.");
    expect(importedNotice(null, 1, 0)).toBe("Imported 1 ingredient. Check the amounts before you save.");
  });
});
