import { reactive } from "vue";
import { importRecipe, ServerUnreachable, type FoodSearchRow } from "../api";
import { rowsFrom, type DescribeRow } from "../lib/describe";
import { importSource } from "../lib/recipeImport";
import { describe } from "./describe";

// New recipe's "Import a recipe": a link or pasted ingredients, matched to foods by the server. The state lives
// here, not in the screen, because the search and amount steps replace it while a row is being changed.

export type ImportPhase = "write" | "finding" | "review";

export const recipeImport = reactive({
  text: "",
  phase: "write" as ImportPhase,
  error: "",
  rows: [] as DescribeRow[],
  /** From the page: its recipe's name, portions and site. Empty for pasted text. */
  name: "",
  portions: null as number | null,
  site: null as string | null,
  /** Row open on the search or amount step; picking a food there puts it in this row. */
  editing: null as number | null,
});

let gen = 0;

export function resetImport(): void {
  gen += 1;
  Object.assign(recipeImport, { text: "", phase: "write", error: "", rows: [], name: "", portions: null, site: null, editing: null });
}

export async function findIngredients(): Promise<void> {
  const source = importSource(recipeImport.text);
  if (!source || recipeImport.phase === "finding") return;
  const mine = ++gen;
  recipeImport.phase = "finding";
  recipeImport.error = "";
  try {
    const result = await importRecipe(source);
    if (mine !== gen) return;
    describe.left = result.left;
    recipeImport.rows = rowsFrom(result.items, () => crypto.randomUUID());
    recipeImport.name = result.name;
    recipeImport.portions = result.portions;
    recipeImport.site = result.site;
    recipeImport.phase = "review";
  } catch (error) {
    if (mine !== gen) return;
    recipeImport.phase = "write";
    if (error instanceof ServerUnreachable) recipeImport.error = "Server unreachable, try again.";
    else recipeImport.error = error instanceof Error && error.message ? error.message : "Couldn't import that recipe.";
  }
}

export function toggleImportRow(index: number): void {
  const row = recipeImport.rows[index];
  if (row?.food) row.on = !row.on;
}

/** A food picked for a row from search or its amount screen: the row now has it, checked. */
export function setImportRow(index: number, food: FoodSearchRow, amount: number, unit: string): void {
  const row = recipeImport.rows[index];
  if (!row) return;
  Object.assign(row, { food, amount, unit, on: true, guessed: false });
}
