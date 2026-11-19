import { expect, it } from "vitest";
import type { CatalogFood } from "../src/lib/foodAmount";
import {
  canSaveRecipe,
  finishedError,
  ingredientMacros,
  ingredientSource,
  matchingRecipes,
  perPortion,
  perPortionSentence,
  portionGrams,
  portionNutrients,
  recipeLogFactor,
  recipeLogProblem,
  recipeServingLine,
  recipeTotalLine,
  recipeMacro,
  presetFromLogged,
  recipeFoodEntries,
  recipeNameError,
  scaleRecipeLog,
  scaleStoredLine,
  scaleStoredSource,
  selectionSkipNote,
  sumTotals,
} from "../src/lib/recipes";

const chicken: CatalogFood = {
  id: "chicken",
  source: "custom",
  name: "Chicken",
  nameEn: null,
  basis: "g",
  nutrientBasis: "per_100",
  kcalPer100: 400,
  proteinPer100: 100,
  fatPer100: 10,
  carbsPer100: 0,
  servingQuantity: null,
  servingLabel: null,
  pieceQuantity: null,
  pieceLabel: null,
};

it("shows grams to one decimal and leaves the computed fat at 3.75", () => {
  const per = perPortion({ kcal: 150, protein: 15, fat: 3.75, carbs: 7.5 }, 1);
  expect(per).toEqual({ kcal: 150, protein: 15, fat: 3.75, carbs: 7.5 });
  expect(recipeMacro(per!.fat)).toBe("3.8");
  expect(recipeMacro(per!.carbs)).toBe("7.5");
  expect(recipeMacro(per!.protein)).toBe("15");
  expect(perPortionSentence(per!)).toBe("15 g protein per portion");
});

it("shows 50 g protein per portion from 250 g of a 100 g-protein food split five ways", () => {
  const line = ingredientMacros(chicken, 250, "g");
  expect(line).toEqual({ kcal: 1000, protein: 250, fat: 25, carbs: 0 });
  const per = perPortion(line!, 5);
  expect(per).toEqual({ kcal: 200, protein: 50, fat: 5, carbs: 0 });
  expect(perPortionSentence(per!)).toBe("50 g protein per portion");
  expect(perPortionSentence(perPortion(line!, 10)!)).toBe("25 g protein per portion");
});

it("updates the total when an amount changes and never asks for typed macros", () => {
  const smaller = ingredientMacros(chicken, 100, "g");
  expect(smaller?.protein).toBe(100);
  const total = sumTotals([smaller!, ingredientMacros(chicken, 50, "g")!]);
  expect(total.protein).toBe(150);
  expect(perPortion(total, 3)?.protein).toBe(50);
});

it("logs by portion or by a share of the finished weight, and not by grams without one", () => {
  const recipe = { portions: 5, finishedGrams: 500, kcal: 1000, protein: 250, fat: 25, carbs: 0 };
  expect(scaleRecipeLog(recipe, 1, "portion")).toMatchObject({ protein: 50, kcal: 200, grams: 100 });
  expect(scaleRecipeLog(recipe, 0.5, "portion")).toMatchObject({ protein: 25, grams: 50 });
  expect(scaleRecipeLog(recipe, 100, "g")).toMatchObject({ protein: 50, kcal: 200, grams: 100 });
  expect(scaleRecipeLog({ ...recipe, finishedGrams: null }, 1, "portion")?.grams).toBeNull();
  expect(scaleRecipeLog({ ...recipe, finishedGrams: null }, 100, "g")).toBeNull();
});

it("adds grams and millilitres as nutrients only", () => {
  const milk: CatalogFood = { ...chicken, id: "milk", name: "Milk", basis: "ml", kcalPer100: 50, proteinPer100: 5, fatPer100: 2, carbsPer100: 6 };
  const solid = ingredientMacros(chicken, 100, "g");
  const liquid = ingredientMacros(milk, 100, "ml");
  expect(solid).toEqual({ kcal: 400, protein: 100, fat: 10, carbs: 0 });
  expect(liquid).toEqual({ kcal: 50, protein: 5, fat: 2, carbs: 6 });
  expect(sumTotals([solid!, liquid!])).toEqual({ kcal: 450, protein: 105, fat: 12, carbs: 6 });
  expect(ingredientMacros(milk, 100, "g")).toBeNull();
});

it("keeps a retired ingredient's saved protein until the amount changes", () => {
  const stored = { amount: 250, kcal: 1000, protein: 250, fat: 25, carbs: 0 };
  expect(scaleStoredLine(stored, 250)).toEqual({ kcal: 1000, protein: 250, fat: 25, carbs: 0 });
  expect(scaleStoredLine(stored, 125)).toEqual({ kcal: 500, protein: 125, fat: 12.5, carbs: 0 });
});

it("needs two real foods before Save as recipe, and leaves quick add out", () => {
  const entries = [
    { source: "custom", foodId: "a" },
    { source: "quick", foodId: null },
    { source: "recipe", foodId: null },
    { source: "mvt", foodId: "b" },
  ];
  expect(recipeFoodEntries(entries)).toHaveLength(2);
  expect(canSaveRecipe(1)).toBe(false);
  expect(canSaveRecipe(recipeFoodEntries(entries).length)).toBe(true);
  expect(selectionSkipNote(entries)).toBe("Quick add isn't included. A logged recipe isn't an ingredient.");
  expect(recipeNameError("  ")).toBe("Give the recipe a name.");
  expect(recipeNameError("Stew")).toBeNull();
});

it("matches a recipe by its name or an ingredient and prefers a logged gram weight", () => {
  const recipes = [
    { name: "Stew", ingredients: [{ name: "Chicken" }] },
    { name: "Oats", ingredients: [{ name: "Milk" }] },
  ];
  expect(matchingRecipes(recipes, "chick").map((recipe) => recipe.name)).toEqual(["Stew"]);
  expect(matchingRecipes(recipes, "").length).toBe(2);
  const bread: CatalogFood = { ...chicken, servingQuantity: null, servings: [{ id: "s", name: "slice", grams: 40 }] };
  expect(presetFromLogged(bread, { amount: 2, unit: "slice", grams: 80 })).toEqual({ amount: "2", unit: "slice" });
  expect(presetFromLogged(chicken, { amount: 2, unit: "slice", grams: 80 })).toEqual({ amount: "80", unit: "g" });
});

it("says how many grams a portion is and why an amount can't be logged", () => {
  const pot = { portions: 4, finishedGrams: 1600, kcal: 2000, protein: 200, fat: 40, carbs: 200 };
  expect(portionGrams(pot)).toBe(400);
  expect(portionGrams({ ...pot, finishedGrams: null })).toBeNull();
  expect(recipeLogProblem(pot, 1, "portion")).toBeNull();
  expect(recipeLogProblem(pot, 1600, "portion")).toBe("Enter portions above 0 and at most 50.");
  expect(recipeLogProblem(pot, 20000, "g")).toBe("Enter grams above 0 and at most 10,000.");
  expect(recipeLogProblem({ ...pot, finishedGrams: null }, 100, "g")).toBe("This recipe has no finished weight, so it can't be logged in grams.");
  expect(recipeLogProblem(pot, 20000, "g", "oz")).toBe("Enter ounces above 0 and at most 352.");
  expect(recipeLogProblem({ ...pot, finishedGrams: null }, 100, "g", "oz")).toBe("This recipe has no finished weight, so it can't be logged in ounces.");
});

it("words the finished weight limit in the shown food unit", () => {
  expect(finishedError(null)).toBeNull();
  expect(finishedError(900)).toBeNull();
  expect(finishedError(0)).toBe("Enter a finished weight above 0 and at most 100,000 g.");
  expect(finishedError(200_000, "oz")).toBe("Enter a finished weight above 0 and at most 3,527 oz.");
});

it("scales an ingredient's whole panel the same way as its macros", () => {
  const greens: CatalogFood = { ...chicken, id: "greens", saturatedFatPer100: 2, saltPer100: 0.5, nutrients: { vitaminC: 40, iron: null } };
  const source = ingredientSource(greens, 250, "g");
  expect(source).toEqual({ fat: 25, saturatedFat: 5, sugars: null, fiber: null, salt: 1.25, nutrients: { vitaminC: 100, iron: null } });
  // A named serving finds the food's own, whatever its case.
  const bread: CatalogFood = { ...greens, servings: [{ id: "s", name: "slice", grams: 40 }] };
  expect(ingredientSource(bread, 2, "Slice")?.nutrients).toEqual({ vitaminC: 32, iron: null });
  expect(ingredientSource(greens, 0, "g")).toBeNull();
  expect(ingredientSource(greens, 1, "cup")).toBeNull();
});

it("scales a saved ingredient's panel with its amount", () => {
  const stored = { amount: 200, fat: 20, salt: 1, nutrients: { sodium: 400 } };
  expect(scaleStoredSource(stored, 200)).toMatchObject({ fat: 20, salt: 1, nutrients: { sodium: 400 } });
  expect(scaleStoredSource(stored, 50)).toMatchObject({ fat: 5, salt: 0.25, nutrients: { sodium: 100 } });
  expect(scaleStoredSource(stored, 0)).toBeNull();
});

it("splits the ingredients' panel into portions, unknown counted as 0", () => {
  const per = portionNutrients([{ nutrients: { vitaminC: 60 } }, { nutrients: { vitaminC: null } }, { nutrients: { vitaminC: 30 } }], 3);
  expect(per.vitaminC).toBe(30);
  expect(portionNutrients([{ nutrients: { vitaminC: 60 } }], 0)).toEqual({});
});

it("writes the ingredients' total and the serving line in whole numbers", () => {
  expect(recipeTotalLine({ kcal: 1755.6, protein: 157.2, fat: 30.4, carbs: 206.5 })).toBe("1,756 kcal · P 157 · F 30 · C 207");
  expect(recipeServingLine({ portions: 3, kcal: 1755 })).toBe("3 portions · 585 kcal each");
  expect(recipeServingLine({ portions: 1, kcal: 600 })).toBe("1 portion · 600 kcal each");
  expect(recipeServingLine({ portions: 0, kcal: 600 })).toBe("");
});

it("gives the share of the recipe one log is, inside the same limits as the totals", () => {
  const recipe = { portions: 4, finishedGrams: 800, kcal: 2000, protein: 100, fat: 40, carbs: 200 };
  expect(recipeLogFactor(recipe, 1, "portion")).toBe(0.25);
  expect(recipeLogFactor(recipe, 200, "g")).toBe(0.25);
  expect(recipeLogFactor({ ...recipe, finishedGrams: null }, 200, "g")).toBeNull();
  expect(recipeLogFactor(recipe, 51, "portion")).toBeNull();
});
