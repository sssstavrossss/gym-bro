import { expect, it } from "vitest";
import {
  amountError,
  macroFigure,
  macrosForFood,
  parseAmount,
  per100Line,
  scaleStored,
  unitsForEntry,
  unitsForFood,
  type CatalogFood,
} from "../src/lib/foodAmount";

const chicken: CatalogFood = {
  id: "1",
  source: "mvt",
  name: "Fictional kylling fillet",
  nameEn: "Fictional chicken fillet",
  basis: "g",
  nutrientBasis: "per_100",
  kcalPer100: 200,
  proteinPer100: 30,
  fatPer100: 4,
  carbsPer100: 0,
  servingQuantity: 40,
  servingLabel: "porsjon",
  pieceQuantity: 60,
  pieceLabel: "filet",
};

const bar: CatalogFood = {
  ...chicken,
  id: "2",
  source: "custom",
  name: "Fictional serving bar",
  nameEn: null,
  basis: "serving",
  nutrientBasis: "per_serving",
  kcalPer100: 80,
  proteinPer100: 10,
  fatPer100: 2,
  carbsPer100: 3,
  servingQuantity: null,
  servingLabel: null,
  pieceQuantity: null,
  pieceLabel: null,
};

it("accepts a decimal comma or point", () => {
  expect(parseAmount("12,5")).toBe(12.5);
  expect(parseAmount("12.5")).toBe(12.5);
  expect(parseAmount("")).toBe(0);
});

it("rejects 0 and 10,001 g and 51 servings with the server's words", () => {
  expect(amountError(0, "g")).toBe("Enter an amount above 0 and at most 10,000 g.");
  expect(amountError(10001, "g")).toBe("Enter an amount above 0 and at most 10,000 g.");
  expect(amountError(0.5, "g")).toBeNull();
  expect(amountError(10000, "g")).toBeNull();
  expect(amountError(51, "serving")).toBe("Enter an amount above 0 and at most 50 servings.");
  expect(amountError(50, "serving")).toBeNull();
  expect(amountError(50, "piece")).toBeNull();
});

it("offers grams plus a serving or piece only when the food has one", () => {
  expect(unitsForFood(chicken).map((unit) => unit.unit)).toEqual(["g", "serving", "piece"]);
  expect(unitsForFood({ ...chicken, servingQuantity: null, pieceQuantity: null }).map((unit) => unit.unit)).toEqual(["g"]);
  expect(unitsForFood({ ...chicken, basis: "ml" }).map((unit) => unit.unit)).toEqual(["ml", "serving", "piece"]);
  expect(unitsForFood(bar).map((unit) => unit.unit)).toEqual(["serving"]);
});

it("previews label calories from the food", () => {
  expect(macrosForFood(chicken, 150, "g")).toEqual({ kcal: 300, protein: 45, fat: 6, carbs: 0, grams: 150 });
  expect(macrosForFood(chicken, 2, "piece")).toMatchObject({ grams: 120, kcal: 240 });
  expect(macrosForFood(bar, 1, "serving")).toEqual({ kcal: 80, protein: 10, fat: 2, carbs: 3, grams: null });
});

it("keeps one decimal on a fractional macro and no .0 on a whole one", () => {
  expect(macroFigure(0)).toBe("0");
  expect(macroFigure(4)).toBe("4");
  expect(macroFigure(31)).toBe("31");
  expect(macroFigure(10)).toBe("10");
  expect(macroFigure(3.6)).toBe("3.6");
  expect(macroFigure(3.64)).toBe("3.6");
  expect(macroFigure(3.65)).toBe("3.7");
  expect(per100Line({ ...chicken, kcalPer100: 165, proteinPer100: 31, fatPer100: 3.6, carbsPer100: 0 }))
    .toBe("per 100 g · 165 kcal · P31 F3.6 C0");
});

it("does not call an unconfirmed Kassalapp row per 100 g, and millilitres have no gram weight", () => {
  const drink: CatalogFood = {
    ...chicken,
    id: "3",
    source: "kassalapp",
    name: "Oatly Havredrikk",
    nameEn: null,
    basis: null,
    nutrientBasis: "unconfirmed",
    kcalPer100: 48,
    proteinPer100: 1.1,
    fatPer100: 1.5,
    carbsPer100: 7,
    servingQuantity: null,
    pieceQuantity: null,
  };
  expect(per100Line(drink)).toBe("as reported · 48 kcal · P1.1 F1.5 C7");
  expect(per100Line({ ...drink, confirmedBasis: "g" })).toBe("as reported · 48 kcal · P1.1 F1.5 C7");
  expect(unitsForFood(drink).map((unit) => unit.unit)).toEqual(["g", "ml"]);
  expect(macrosForFood(drink, 250, "ml")).toEqual({
    kcal: 120, protein: 2.75, fat: 3.75, carbs: 17.5, grams: null,
  });
  expect(macrosForFood(drink, 100, "g")).toEqual({
    kcal: 48, protein: 1.1, fat: 1.5, carbs: 7, grams: 100,
  });
  expect(unitsForFood({ ...chicken, basis: "ml", servingQuantity: null, pieceQuantity: null }).map((unit) => unit.unit)).toEqual(["ml"]);
});

it("scales an edited entry from its stored grams, not a new piece size", () => {
  const logged = { amount: 2, unit: "piece", grams: 120, kcal: 240, protein: 36, fat: 4.8, carbs: 0 };
  expect(scaleStored(logged, 3, "piece")).toMatchObject({ grams: 180, kcal: 360, protein: 54 });
  expect(scaleStored({ amount: 150, unit: "g", grams: 150, kcal: 300, protein: 45, fat: 6, carbs: 0 }, 300, "g"))
    .toMatchObject({ grams: 300, kcal: 600 });
  expect(scaleStored({ amount: 1, unit: "serving", grams: null, kcal: 80, protein: 10, fat: 2, carbs: 3 }, 2, "serving"))
    .toEqual({ kcal: 160, protein: 20, fat: 4, carbs: 6, grams: null });
  expect(scaleStored({ amount: 250, unit: "ml", grams: null, kcal: 92.5, protein: 2.5, fat: 1.25, carbs: 16.75 }, 500, "ml"))
    .toEqual({ kcal: 185, protein: 5, fat: 2.5, carbs: 33.5, grams: null });
  expect(unitsForEntry(logged).find((unit) => unit.unit === "piece")?.gramsEach).toBe(60);
});
