import { reactive } from "vue";
import { todayInZone, todayIso } from "./lib/dates";
import { primeKeyboard } from "./lib/focusField";
import { deviceTimeZone } from "./state/profile";

export const ui = reactive({
  sheet: null as null | "weight" | "accuracy" | "chooser" | "food" | "copy" | "group" | "recipe" | "recalculate",
  foodTab: "search" as "search" | "quick",
  /** Food open in the detail view. Null on the search list. */
  detailFoodId: null as string | null,
  /** Custom food editor. A seed may carry a name and quick-add numbers, never invented nutrients. */
  foodEditor: null as null | {
    id?: string;
    seed?: { name?: string; kcal?: number; protein?: number; fat?: number; carbs?: number };
    ret: "list" | "detail";
  },
  editEntryId: null as string | null,
  toast: null as null | { id: number; text: string; action?: { label: string; run: () => void } },
  weightDate: todayIso(),
  /** Local date the open food sheet will log to. Today unless a past day asked. */
  foodDate: todayIso(),
  accReturn: null as null | "weight",
  keepWeightDraft: false,
  /** Log multi-select. The bar offers Copy to…, Save as group, and Delete. */
  selecting: false,
  selected: [] as string[],
  /** Last row clicked, so Shift can extend a range. */
  anchor: null as string | null,
  /** Opened from one row, so closing Copy to… also leaves select mode. */
  copySingle: false,
  /** Entries the group sheet will save. */
  groupEntryIds: [] as string[],
  /** Food sheet to reopen after naming a group. Null returns to the log. */
  groupReturn: null as null | "food",
  /** The food sheet was only covered by Save as group or a recipe, so keep its session. */
  resumeFood: false,
  /** Recipe sheet. create with entry ids is Save as recipe. */
  recipeMode: null as null | "create" | "edit" | "log",
  recipeId: null as string | null,
  recipeEntryIds: [] as string[],
  /** Food sheet or select mode to restore when the recipe sheet closes. */
  recipeReturn: null as null | "food" | "select",
});

let toastTimer = 0;

export function runToastAction(): void {
  const action = ui.toast?.action;
  ui.toast = null;
  action?.run();
}

export function toast(text: string, action?: { label: string; run: () => void }): void {
  const id = Date.now();
  ui.toast = action ? { id, text, action } : { id, text };
  window.clearTimeout(toastTimer);
  // Undo stays up for at least 5 seconds (decision 39).
  toastTimer = window.setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null;
  }, action ? 5000 : 4000);
}

export function openRecalculate(): void {
  ui.sheet = "recalculate";
}

export function openWeight(): void {
  primeKeyboard();
  ui.editEntryId = null;
  ui.sheet = "weight";
}

export function openAccuracy(from?: "weight"): void {
  if (from === "weight") ui.keepWeightDraft = true;
  ui.accReturn = from ?? null;
  ui.sheet = "accuracy";
}

export function closeAccuracy(): void {
  const back = ui.accReturn === "weight";
  ui.accReturn = null;
  ui.sheet = back ? "weight" : null;
  if (!back) ui.keepWeightDraft = false;
}

/** Step back inside the food sheet. True when a layer closed and the sheet stays open. */
export function closeFoodLayer(): boolean {
  if (ui.foodEditor) {
    const ret = ui.foodEditor.ret;
    ui.foodEditor = null;
    if (ret !== "detail") ui.detailFoodId = null;
    return true;
  }
  if (ui.sheet === "food" && ui.detailFoodId && !ui.editEntryId) {
    ui.detailFoodId = null;
    return true;
  }
  return false;
}

export function closeSheet(): void {
  ui.sheet = null;
  ui.accReturn = null;
  ui.keepWeightDraft = false;
  ui.editEntryId = null;
  ui.detailFoodId = null;
  ui.foodEditor = null;
}

export function openAdd(): void {
  ui.editEntryId = null;
  ui.sheet = "chooser";
}

export function openFood(tab: "search" | "quick" = "search", date?: string): void {
  primeKeyboard();
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = null;
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodTab = tab;
  ui.foodDate = date && date <= today ? date : today;
  ui.sheet = "food";
}

export function startSelect(id?: string): void {
  ui.selecting = true;
  ui.selected = id ? [id] : [];
  ui.anchor = id ?? null;
}

export function endSelect(): void {
  ui.selecting = false;
  ui.selected = [];
  ui.anchor = null;
}

/** single: opened from one row's Copy to…, so closing it also leaves select mode. */
export function openCopy(single = false): void {
  primeKeyboard();
  ui.copySingle = single;
  ui.sheet = "copy";
}

export function openGroupSheet(ids: string[], returnTo: "food" | null): void {
  primeKeyboard();
  ui.groupEntryIds = ids.slice();
  ui.groupReturn = returnTo;
  ui.sheet = "group";
}

function clearRecipe(): void {
  ui.recipeMode = null;
  ui.recipeId = null;
  ui.recipeEntryIds = [];
  ui.recipeReturn = null;
}

export function openRecipeCreate(returnTo: "food" | null): void {
  if (ui.sheet === "recipe" && ui.recipeMode === "create" && ui.recipeId == null) return;
  primeKeyboard();
  ui.recipeMode = "create";
  ui.recipeId = null;
  ui.recipeEntryIds = [];
  ui.recipeReturn = returnTo;
  ui.sheet = "recipe";
}

export function openRecipeEdit(id: string): void {
  primeKeyboard();
  ui.recipeMode = "edit";
  ui.recipeId = id;
  ui.recipeEntryIds = [];
  ui.recipeReturn = "food";
  ui.sheet = "recipe";
}

export function openRecipeLog(id: string): void {
  primeKeyboard();
  ui.recipeMode = "log";
  ui.recipeId = id;
  ui.recipeEntryIds = [];
  ui.recipeReturn = "food";
  ui.sheet = "recipe";
}

export function openRecipeFromEntries(ids: string[], returnTo: "food" | "select"): void {
  primeKeyboard();
  ui.recipeMode = "create";
  ui.recipeId = null;
  ui.recipeEntryIds = ids.slice();
  ui.recipeReturn = returnTo;
  ui.sheet = "recipe";
}

export function closeRecipeSheet(): void {
  const back = ui.recipeReturn;
  clearRecipe();
  if (back === "food") {
    ui.resumeFood = true;
    ui.sheet = "food";
    return;
  }
  ui.sheet = null;
}

/** Saved from Select mode leaves the selection. Saved from the food sheet returns there. */
export function finishRecipeSave(): void {
  const back = ui.recipeReturn;
  closeRecipeSheet();
  if (back === "select") endSelect();
}

export function closeGroupSheet(): void {
  const back = ui.groupReturn;
  ui.groupReturn = null;
  ui.groupEntryIds = [];
  if (back === "food") {
    ui.resumeFood = true;
    ui.sheet = "food";
    return;
  }
  ui.sheet = null;
}

/** Saved from Select mode leaves the selection. Saved from the food sheet returns there. */
export function finishGroupSave(): void {
  const back = ui.groupReturn;
  closeGroupSheet();
  if (back !== "food") endSelect();
}

export function closeCopy(): void {
  const single = ui.copySingle;
  ui.copySingle = false;
  closeSheet();
  if (single) endSelect();
}

export function openEdit(id: string, date?: string): void {
  primeKeyboard();
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = id;
  ui.foodDate = date && date <= today ? date : ui.foodDate || today;
  ui.foodTab = "quick";
  ui.sheet = "food";
}
