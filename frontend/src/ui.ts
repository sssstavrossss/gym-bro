import { reactive } from "vue";
import { todayInZone, todayIso } from "./lib/dates";
import { lastPlanDate } from "./lib/dayLog";
import { primeKeyboard, rememberOpener } from "./lib/focusField";
import type { PageCard } from "./lib/cardPages";
import type { FoodPage } from "./lib/foodPages";
import type { SheetName } from "./lib/layout";
import { emptySelection, type Selection } from "./lib/selection";
import { TOAST_LIFE, TOAST_SHORT, enqueue, frontTimer, toastLife, type QueuedToast, type ToastAction, type ToastMerge } from "./lib/toastQueue";
import { deviceTimeZone } from "./state/profile";

/** Add food tabs. Describe shows only when the server can describe meals. */
export type FoodTab = "search" | "describe" | "quick";

export type SettingsView = "main" | "home" | "country";

export const ui = reactive({
  sheet: null as SheetName | null,
  foodTab: "search" as FoodTab,
  /** The Add food page the Search tab opens on (the fan's Recipes, My foods and Groups open on theirs). */
  foodPage: "recent" as FoodPage,
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
  /** Waiting toasts: [0] is in front and counting down, [1] shows its edge behind, the rest wait unseen. */
  toasts: [] as QueuedToast[],
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
  /** Copy to… was opened from Add food's "added" card, so closing it goes back there. */
  copyReturn: null as null | "food",
  /** Edit food was opened from a row on Add food's "added" card, so leaving it goes back to the search. */
  editFromAdded: false,
  /** Select mode on Add food's "added" card. The card's own buttons act on it, apart from the log's selection. */
  addedPick: emptySelection() as Selection,
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
  /** Food sheet, select mode, or logging the recipe again (Edit on Log recipe) when the recipe sheet closes. */
  recipeReturn: null as null | "food" | "select" | "log",
  /** Nutrient open in the nutrient sheet, for the day the Home card shows, with that day's kcal target. */
  nutrient: null as null | { key: string; kcalTarget: number | null },
  /** Exercise open in the how-to sheet (Train → Exercises). */
  exercise: null as string | null,
  /** The how-to is open over the workout sheet, which stays open under it. */
  exerciseOver: false,
  /** The plan workout open in the editor (components/PlanWorkoutSheet.vue). */
  planWorkoutId: null as string | null,
  /** The swipe card whose pages the card pages sheet picks. */
  cardPages: "progress" as PageCard,
  /** The card pages sheet is open over another sheet (a cog on Add food or a recipe), which stays open under it. */
  cardPagesOver: false,
  /** The + fan's editor is open over the fan (from its cog), which stays open under it. */
  fanPagesOver: false,
  /** The page Settings opens on: its list, Home sections (from Home when every card is off), or the food country (from its toast). */
  settingsView: "main" as SettingsView,
});

let toastSeq = 0;
const toastClock = frontTimer(TOAST_LIFE, () => dismissToast());

/**
 * Shows a toast at the bottom of the screen. It waits behind the ones already showing, and its time (4 s, or 6 s
 * with a button) starts when it reaches the front. One with Undo cuts plain toasts ahead of it to a second each.
 * Toasts with the same `merge` kind arriving back to back become one.
 */
export function toast(text: string, action?: ToastAction, options: { error?: boolean; merge?: ToastMerge } = {}): void {
  const spec = { text, ...(action ? { action } : {}), ...(options.error ? { error: true } : {}), ...(options.merge ? { merge: options.merge } : {}) };
  const next = enqueue(ui.toasts, spec, ++toastSeq);
  ui.toasts = next.queue;
  if (next.restart) toastClock.start(toastLife(ui.toasts[0]));
  else if (next.cut) toastClock.shorten(TOAST_SHORT);
}

/** A failure: the alert icon, announced at once. */
export function toastError(text: string): void {
  toast(text, undefined, { error: true });
}

/** Takes the front toast away (its time ran out, it was thrown off, or its button was tapped). The next one comes forward. */
export function dismissToast(id?: number): void {
  const front = ui.toasts[0];
  if (!front || (id != null && front.id !== id)) return;
  ui.toasts = ui.toasts.slice(1);
  toastClock.stop();
  if (ui.toasts.length) toastClock.start(toastLife(ui.toasts[0]));
}

export function runToastAction(): void {
  const front = ui.toasts[0];
  if (!front) return;
  dismissToast(front.id);
  front.action?.run();
}

/** A finger (or the pointer) on the front toast stops its clock until it lets go. */
export function holdToast(held: boolean): void {
  if (held) toastClock.pause();
  else toastClock.resume();
}

/** Clears every toast at once (sign-out, tests). */
export function clearToasts(): void {
  ui.toasts = [];
  toastClock.stop();
}

export function openSettings(view: SettingsView = "main"): void {
  ui.settingsView = view;
  ui.sheet = "settings";
}

export function openNotifications(): void {
  ui.sheet = "notifications";
}

/**
 * Picks which pages a swipe card shows. From Home it is a sheet of its own. From a cog inside
 * another sheet it opens over that sheet, so what was typed there stays.
 */
export function openCardPages(card: PageCard): void {
  ui.cardPages = card;
  if (ui.sheet && ui.sheet !== "card-pages") {
    ui.cardPagesOver = true;
    return;
  }
  ui.cardPagesOver = false;
  ui.sheet = "card-pages";
}

export function closeCardPages(): void {
  if (ui.cardPagesOver) ui.cardPagesOver = false;
  else closeSheet();
}

/**
 * Arranges the + fan's pages. It opens over the fan (its cog) or Settings, so closing it goes back
 * to what was under it.
 */
export function openFanPages(): void {
  if (ui.sheet && ui.sheet !== "fan-pages") {
    ui.fanPagesOver = true;
    return;
  }
  ui.fanPagesOver = false;
  ui.sheet = "fan-pages";
}

export function closeFanPages(): void {
  if (ui.fanPagesOver) ui.fanPagesOver = false;
  else closeSheet();
}

/** What works offline, what is waiting to send, and how old the numbers are. */
export function openOffline(): void {
  ui.sheet = "offline";
}

/** Detail for one ring on the Home nutrient card. */
export function openNutrient(key: string, kcalTarget: number | null): void {
  ui.nutrient = { key, kcalTarget };
  ui.sheet = "nutrient";
}

/** How to do one exercise: photos, muscles and steps. From the workout it opens over it. */
export function openExercise(id: string): void {
  ui.exercise = id;
  if (ui.sheet === "workout") {
    ui.exerciseOver = true;
    return;
  }
  ui.exerciseOver = false;
  ui.sheet = "exercise";
}

export function closeExercise(): void {
  if (ui.exerciseOver) ui.exerciseOver = false;
  else closeSheet();
}

/** The workout being logged, full height. Starting one is up to the caller (state/workout.ts). */
export function openWorkout(): void {
  ui.exerciseOver = false;
  ui.sheet = "workout";
}

/** New plan, or Edit plan when there is one (components/PlanSheet.vue). */
export function openPlan(): void {
  ui.sheet = "plan";
}

/** Edit one of the plan's workouts by hand. */
export function openPlanWorkout(id: string): void {
  ui.planWorkoutId = id;
  ui.sheet = "plan-workout";
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
  if (ui.sheet === "food" && ui.editEntryId && ui.editFromAdded) {
    leaveAddedEdit();
    return true;
  }
  if (ui.sheet === "food" && ui.addedPick.selecting) {
    endAddedPick();
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
  ui.editFromAdded = false;
  ui.addedPick = emptySelection();
}

/** A row on Add food's "added" card opens Edit food in the same sheet. Save, Delete or Back return to the search. */
export function editAdded(id: string): void {
  primeKeyboard();
  ui.addedPick = emptySelection();
  ui.editFromAdded = true;
  ui.editEntryId = id;
}

export function leaveAddedEdit(): void {
  ui.editFromAdded = false;
  ui.editEntryId = null;
  ui.detailFoodId = null;
}

export function endAddedPick(): void {
  ui.addedPick = emptySelection();
}

export function openAdd(): void {
  ui.editEntryId = null;
  ui.sheet = "chooser";
}

export function openFood(tab: FoodTab = "search", date?: string, page: FoodPage = "recent"): void {
  // Search and Describe open on a list (recent foods, recent descriptions) and
  // Describe on its photo button: raising the iOS keyboard would cover them, so
  // only Quick Add primes, like the other sheets.
  if (tab === "quick") primeKeyboard();
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = null;
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodScan = false;
  ui.foodTab = tab;
  ui.foodPage = page;
  ui.foodDate = date && date <= lastPlanDate(today) ? date : today;
  ui.sheet = "food";
}

/** The scanner opens over the food search list. Back returns to the list. */
export function openFoodScan(): void {
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodScan = true;
}

/** Home's scan button: the food sheet for that day, straight to the scanner. */
export function openFoodWithScan(date?: string): void {
  openFood("search", date);
  openFoodScan();
}

/** The fan's New food: Add food on My foods, with the new food form open over it. Closing it leaves My foods showing. */
export function openNewFoodFrom(date?: string): void {
  openFood("search", date, "mine");
  primeKeyboard();
  ui.foodEditor = { ret: "list" };
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

/**
 * Copies the entries in `ui.selected`. single: opened from one row's Copy to…, so closing it also leaves select mode.
 * returnTo "food": from Add food's card, which comes back with its search when Copy to… closes.
 */
export function openCopy(single = false, returnTo: "food" | null = null): void {
  primeKeyboard();
  ui.copySingle = single;
  ui.copyReturn = returnTo;
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

/** From the recipe list, or from Edit on Log recipe, which it goes back to when closed or saved. */
export function openRecipeEdit(id: string, returnTo: "food" | "log" = "food"): void {
  // No primeKeyboard: the recipe form opens with the keyboard down. Its fields opt out of autofocus.
  ui.recipeMode = "edit";
  ui.recipeId = id;
  ui.recipeEntryIds = [];
  ui.recipeReturn = returnTo;
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
  if (back === "log" && ui.recipeId) {
    openRecipeLog(ui.recipeId);
    return;
  }
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

/** done: the copy was made, so a selection on Add food's card ends too. */
export function closeCopy(done = false): void {
  const single = ui.copySingle;
  const back = ui.copyReturn;
  ui.copySingle = false;
  ui.copyReturn = null;
  if (back === "food") {
    // The card lent its ids to Copy to…; its own selection stays until the copy is made.
    endSelect();
    if (done) endAddedPick();
    ui.resumeFood = true;
    ui.sheet = "food";
    return;
  }
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
