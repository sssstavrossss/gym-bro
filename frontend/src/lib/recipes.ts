import {
  amountError,
  amountLabel,
  foodFactor,
  hasGramBasis,
  macroFigure,
  macrosForFood,
  normalizeUnit,
  round2,
  servingName,
  unitsForFood,
  type CatalogFood,
} from "./foodAmount";
import { int } from "./format";
import { G_PER_OZ, type FoodUnit } from "./foodUnits";
import { dayNutrients, foodSource, scaleMap, scaleSource, type NutrientMap, type NutrientSource } from "./nutrients";

export const recipeNameMax = 120;
export const recipePortionsMax = 1000;
export const recipeFinishedMax = 100_000;
export const recipeLogPortionsMax = 50;

export interface RecipeTotals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * Grams as the rest of the app shows them: a whole number, or one decimal.
 * 3.75 is shown as 3.8. This does not change the stored value.
 */
export function recipeMacro(value: number): string {
  return macroFigure(value);
}

/** Up to two decimals, matching the stored snapshot. 50 stays 50. */
export function recipeFigure(value: number): string {
  const rounded = round2(value);
  if (rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function cleanRecipeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function recipeNameError(raw: string): string | null {
  const name = cleanRecipeName(raw);
  if (!name) return "Give the recipe a name.";
  if (name.length > recipeNameMax) return "Use a shorter name.";
  return null;
}

export function portionsError(value: number): string | null {
  if (!(value > 0) || value > recipePortionsMax) return "Enter portions above 0 and at most 1,000.";
  return null;
}

/** `value` is in grams; with Food set to oz the limit is worded in ounces. */
export function finishedError(value: number | null, setting: FoodUnit = "g"): string | null {
  if (value == null) return null;
  if (value > 0 && value <= recipeFinishedMax) return null;
  return setting === "oz"
    ? `Enter a finished weight above 0 and at most ${Math.floor(recipeFinishedMax / G_PER_OZ).toLocaleString("en-US")} oz.`
    : "Enter a finished weight above 0 and at most 100,000 g.";
}

export function sumTotals(rows: readonly RecipeTotals[]): RecipeTotals {
  return {
    kcal: round2(rows.reduce((sum, row) => sum + row.kcal, 0)),
    protein: round2(rows.reduce((sum, row) => sum + row.protein, 0)),
    fat: round2(rows.reduce((sum, row) => sum + row.fat, 0)),
    carbs: round2(rows.reduce((sum, row) => sum + row.carbs, 0)),
  };
}

/** Same factor as the server: nutrient × (part / whole), rounded to 2 decimals. */
export function shareTotals(total: RecipeTotals, factor: number): RecipeTotals {
  return {
    kcal: round2(total.kcal * factor),
    protein: round2(total.protein * factor),
    fat: round2(total.fat * factor),
    carbs: round2(total.carbs * factor),
  };
}

export function perPortion(total: RecipeTotals, portions: number): RecipeTotals | null {
  if (!(portions > 0)) return null;
  return shareTotals(total, 1 / portions);
}

export function perPortionSentence(per: RecipeTotals): string {
  return `${recipeMacro(per.protein)} g protein per portion`;
}

/** The food's unit an ingredient's unit names ("Slice" finds the saved "slice"). Null when the food has none. */
function ingredientUnit(food: CatalogFood, unit: string): string | null {
  const standard = normalizeUnit(unit);
  const named = standard ? null : servingName(unit);
  const key = standard ?? named;
  if (!key) return null;
  const choice = unitsForFood(food).find((item) =>
    item.unit === key || (item.named === true && item.unit.localeCompare(key, undefined, { sensitivity: "accent" }) === 0));
  return choice?.unit ?? null;
}

/** Nutrition for one ingredient from the food's own basis. Null when the amount or unit cannot be used. */
export function ingredientMacros(food: CatalogFood, amount: number, unit: string): RecipeTotals | null {
  if (amountError(amount, unit)) return null;
  const key = ingredientUnit(food, unit);
  if (!key) return null;
  const macros = macrosForFood(food, amount, key);
  return { kcal: macros.kcal, protein: macros.protein, fat: macros.fat, carbs: macros.carbs };
}

/** The rest of one ingredient's panel (fats, vitamins, minerals), scaled the same way as its macros. */
export function ingredientSource(food: CatalogFood, amount: number, unit: string): NutrientSource | null {
  if (amountError(amount, unit)) return null;
  const key = ingredientUnit(food, unit);
  const scaled = key ? foodFactor(food, amount, key) : null;
  return scaled ? scaleSource(foodSource(food), scaled.factor) : null;
}

/** Scale a retired ingredient's saved nutrients with the amount. The unit does not change. */
export function scaleStoredLine(stored: RecipeTotals & { amount: number }, amount: number): RecipeTotals | null {
  if (!(amount > 0) || !(stored.amount > 0)) return null;
  if (round2(amount) === round2(stored.amount)) {
    return { kcal: stored.kcal, protein: stored.protein, fat: stored.fat, carbs: stored.carbs };
  }
  return shareTotals(stored, amount / stored.amount);
}

/** The same for the saved panel. */
export function scaleStoredSource(stored: NutrientSource & { amount: number }, amount: number): NutrientSource | null {
  if (!(amount > 0) || !(stored.amount > 0)) return null;
  return scaleSource(stored, round2(amount) === round2(stored.amount) ? 1 : amount / stored.amount);
}

/** One portion's panel: the ingredients' sum, unknown counted as 0 as on a day, split by portions. */
export function portionNutrients(lines: readonly NutrientSource[], portions: number): NutrientMap {
  if (!(portions > 0)) return {};
  return scaleMap(dayNutrients(lines), 1 / portions);
}

/** Whole grams on one line: "1,756 kcal · P 157 · F 30 · C 207". */
export function recipeTotalLine(total: RecipeTotals): string {
  return `${int(total.kcal)} kcal · P ${int(total.protein)} · F ${int(total.fat)} · C ${int(total.carbs)}`;
}

/** Under a recipe's name when logging it: "3 portions · 585 kcal each". */
export function recipeServingLine(recipe: { portions: number; kcal: number }): string {
  if (!(recipe.portions > 0)) return "";
  return `${amountLabel(recipe.portions, "portion")} · ${int(recipe.kcal / recipe.portions)} kcal each`;
}

export interface RecipeLogInput extends RecipeTotals {
  portions: number;
  finishedGrams: number | null;
}

/**
 * The share of the whole recipe one log is: portions ÷ portions made, or grams ÷ finished weight.
 * Grams are offered only when a finished weight was saved. Null outside the limits.
 */
export function recipeLogFactor(recipe: RecipeLogInput, amount: number, unit: "portion" | "g"): number | null {
  if (unit === "g") {
    if (!(recipe.finishedGrams != null && recipe.finishedGrams > 0)) return null;
    if (!(amount > 0) || amount > 10000) return null;
    return amount / recipe.finishedGrams;
  }
  if (!(recipe.portions > 0) || !(amount > 0) || amount > recipeLogPortionsMax) return null;
  return amount / recipe.portions;
}

/** What one log of this recipe is worth, with its weight when the recipe has a finished weight. */
export function scaleRecipeLog(
  recipe: RecipeLogInput,
  amount: number,
  unit: "portion" | "g",
): (RecipeTotals & { grams: number | null }) | null {
  const factor = recipeLogFactor(recipe, amount, unit);
  if (factor == null) return null;
  const totals = shareTotals({ kcal: recipe.kcal, protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs }, factor);
  if (unit === "g") return { ...totals, grams: round2(amount) };
  const weight = recipe.finishedGrams != null && recipe.finishedGrams > 0 ? round2(recipe.finishedGrams * factor) : null;
  return { ...totals, grams: weight != null && weight > 0 ? weight : null };
}

/** Grams in one portion, when the recipe has a finished weight. */
export function portionGrams(recipe: { portions: number; finishedGrams: number | null }): number | null {
  if (!(recipe.portions > 0) || recipe.finishedGrams == null || !(recipe.finishedGrams > 0)) return null;
  return round2(recipe.finishedGrams / recipe.portions);
}

/** Why an amount can't be logged, in words. Null when it can. Same limits as `scaleRecipeLog`. */
export function recipeLogProblem(recipe: RecipeLogInput, amount: number, unit: "portion" | "g", setting: FoodUnit = "g"): string | null {
  if (scaleRecipeLog(recipe, amount, unit)) return null;
  if (unit === "g") {
    const word = setting === "oz" ? "ounces" : "grams";
    if (!(recipe.finishedGrams != null && recipe.finishedGrams > 0)) return `This recipe has no finished weight, so it can't be logged in ${word}.`;
    return setting === "oz" ? "Enter ounces above 0 and at most 352." : "Enter grams above 0 and at most 10,000.";
  }
  return `Enter portions above 0 and at most ${recipeLogPortionsMax}.`;
}

export function recipeFoodEntries<T extends { source: string; foodId: string | null }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.source !== "quick" && Boolean(entry.foodId));
}

/** Save as recipe needs two foods. A quick add is not an ingredient. */
export function canSaveRecipe(count: number): boolean {
  return count >= 2;
}

export function selectionSkipNote(entries: readonly { source: string; foodId: string | null }[]): string {
  const notes: string[] = [];
  if (entries.some((entry) => entry.source === "quick")) notes.push("Quick add isn't included.");
  if (entries.some((entry) => entry.source !== "quick" && !entry.foodId)) notes.push("A logged recipe isn't an ingredient.");
  return notes.join(" ");
}

export interface RecipeMatch {
  name: string;
  ingredients: { name: string }[];
}

export function matchingRecipes<T extends RecipeMatch>(recipes: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...recipes];
  return recipes.filter((recipe) =>
    recipe.name.toLowerCase().includes(needle)
    || recipe.ingredients.some((item) => item.name.toLowerCase().includes(needle)));
}

/** Prefer the logged unit. A missing serving falls back to the stored grams on a per-100 g food. */
export function presetFromLogged(
  food: CatalogFood,
  entry: { amount: number; unit: string; grams: number | null },
): { amount: string; unit: string } {
  const choices = unitsForFood(food);
  const standard = normalizeUnit(entry.unit);
  const named = standard ? null : servingName(entry.unit);
  const key = standard ?? named;
  const match = key
    ? choices.find((item) => item.unit === key || (item.named === true && item.unit.localeCompare(key, undefined, { sensitivity: "accent" }) === 0))
    : undefined;
  if (match) return { amount: String(entry.amount), unit: match.unit };
  if (entry.grams != null && entry.grams > 0 && hasGramBasis(food)) return { amount: String(entry.grams), unit: "g" };
  const first = choices[0];
  return { amount: first?.unit === "g" || first?.unit === "ml" ? "100" : "1", unit: first?.unit ?? "g" };
}
