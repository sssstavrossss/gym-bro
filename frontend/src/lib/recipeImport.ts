import type { DescribeItem } from "../api";
import { chosenRows, rowKcal, type DescribeRow } from "./describe";
import { int } from "./format";

/** A pasted ingredient list can be long; a link is short. The server takes the same. */
export const RECIPE_IMPORT_MAX = 4000;

export const importPlaceholder = "Paste a link to a recipe, or its ingredients, one per line";
export const importHint = "From a link, the name and portions come too. Claude matches each ingredient to a food, and you check them before they go in the recipe.";
export const importNote = "The page or text goes to Claude. Calories come from Matvaretabellen and your own foods.";

/** What the box holds: one web link, or ingredient text. */
export type ImportSource = { url: string } | { text: string };

/** A single http(s) link on its own is a link; anything else is ingredients. */
export function importSource(input: string): ImportSource | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") return { url: url.href };
    } catch {
      // Not a link after all: read it as text.
    }
  }
  return { text: trimmed.slice(0, RECIPE_IMPORT_MAX) };
}

export interface RecipeImportResult {
  /** The recipe's name from the page, or empty for pasted text. */
  name: string;
  /** Portions from the page ("Serves 4"), when it says. */
  portions: number | null;
  /** The site the recipe came from ("matprat.no"), for the line in the form. */
  site: string | null;
  items: DescribeItem[];
  left: number;
}

function ingredientsWord(count: number): string {
  return count === 1 ? "1 ingredient" : `${count} ingredients`;
}

/** "9 ingredients", or "9 of 11 found" when some didn't match. */
export function importTitle(rows: readonly DescribeRow[]): string {
  const found = rows.filter((row) => row.food != null).length;
  return found === rows.length ? ingredientsWord(found) : `${found} of ${rows.length} found`;
}

/** "Use 9 ingredients · 1,840 kcal", or "Use" when nothing is checked. */
export function importUseLabel(rows: readonly DescribeRow[]): string {
  const chosen = chosenRows(rows);
  if (!chosen.length) return "Use";
  const kcal = chosen.reduce((sum, row) => sum + rowKcal(row), 0);
  return `Use ${ingredientsWord(chosen.length)} · ${int(kcal)} kcal`;
}

/** The line over the filled form: where it came from, and that it needs checking. */
export function importedNotice(site: string | null, added: number, skipped: number): string {
  const from = site ? `Imported from ${site}.` : `Imported ${ingredientsWord(added)}.`;
  const left = skipped ? ` ${skipped === 1 ? "1 ingredient wasn't" : `${skipped} ingredients weren't`} added.` : "";
  return `${from}${left} Check the amounts before you save.`;
}
