import { reactive } from "vue";
import { todayInZone, todayIso } from "./lib/dates";
import { lastPlanDate } from "./lib/dayLog";
import { primeKeyboard, rememberOpener } from "./lib/focusField";
import type { PageCard } from "./lib/cardPages";
import type { SheetName } from "./lib/layout";
import { deviceTimeZone } from "./state/profile";

export const ui = reactive({
  sheet: null as SheetName | null,
  foodTab: "search" as "search" | "quick",
  /** Food open in the detail view. Null on the search list. */
  detailFoodId: null as string | null,
  /** Custom food editor. A seed may carry a name and quick-add numbers, never invented nutrients. */
  foodEditor: null as null | {
    id?: string;
    seed?: { name?: string; kcal?: number; protein?: number; fat?: number; carbs?: number; barcode?: string };
    ret: "list" | "detail";
  },
  /** The barcode scanner is open over the search list. */
  foodScan: false,
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
  /** Nutrient open in the nutrient sheet, for the day the Home card shows, with that day's kcal target. */
  nutrient: null as null | { key: string; kcalTarget: number | null },
  /** The Home card whose pages the card pages sheet picks. */
  cardPages: "progress" as PageCard,
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

export function openSettings(): void {
  ui.sheet = "settings";
}

export function openNotifications(): void {
  ui.sheet = "notifications";
}

/** Picks which pages a Home swipe card shows. */
export function openCardPages(card: PageCard): void {
  ui.cardPages = card;
  ui.sheet = "card-pages";
}

/** Detail for one ring on the Home nutrient card. */
export function openNutrient(key: string, kcalTarget: number | null): void {
  ui.nutrient = { key, kcalTarget };
  ui.sheet = "nutrient";
}

export function openRecalculate(): void {
  ui.sheet = "recalculate";
}

export function openWeight(): void {
  // No primeKeyboard: the weight field never takes focus on open, and a phone types on the app keypad.
  // Priming would leave the hidden text proxy focused and raise the letter keyboard over the sheet.
  rememberOpener();
  ui.editEntryId = null;
  ui.sheet = "weight";
}

/** Goal weight types on the app keypad on a phone, like the weight sheet, so nothing primes the keyboard. */
export function openGoalWeight(): void {
  rememberOpener();
  ui.sheet = "goal-weight";
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
  if (ui.foodScan) {
    ui.foodScan = false;
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
  ui.foodScan = false;
}

export function openAdd(): void {
  ui.editEntryId = null;
  ui.sheet = "chooser";
}

export function openFood(tab: "search" | "quick" = "search", date?: string): void {
  // Search opens on the recents list. Focusing it would raise the iOS keyboard
  // and cover that list. Quick Add still primes, like the other sheets.
  if (tab !== "search") primeKeyboard();
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = null;
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodScan = false;
  ui.foodTab = tab;
  ui.foodDate = date && date <= lastPlanDate(today) ? date : today;
  ui.sheet = "food";
}

/** The scanner opens over the food search list. Back returns to the list. */
export function openFoodScan(): void {
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodScan = true;
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
  // No primeKeyboard: the recipe form opens with the keyboard down. Its fields opt out of autofocus.
  ui.recipeMode = "create";
  ui.recipeId = null;
  ui.recipeEntryIds = [];
  ui.recipeReturn = returnTo;
  ui.sheet = "recipe";
}

export function openRecipeEdit(id: string): void {
  // No primeKeyboard: the recipe form opens with the keyboard down. Its fields opt out of autofocus.
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
  // No primeKeyboard: the recipe form opens with the keyboard down. Its fields opt out of autofocus.
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
  ui.foodDate = date && date <= lastPlanDate(today) ? date : ui.foodDate || today;
  ui.foodTab = "quick";
  ui.sheet = "food";
}
