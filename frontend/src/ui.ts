import { reactive } from "vue";
import { todayInZone, todayIso } from "./lib/dates";
import { deviceTimeZone } from "./state/profile";

export const ui = reactive({
  sheet: null as null | "weight" | "accuracy" | "chooser" | "food",
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

export function openWeight(): void {
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
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = null;
  ui.detailFoodId = null;
  ui.foodEditor = null;
  ui.foodTab = tab;
  ui.foodDate = date && date <= today ? date : today;
  ui.sheet = "food";
}

export function openEdit(id: string, date?: string): void {
  const today = todayInZone(deviceTimeZone());
  ui.editEntryId = id;
  ui.foodDate = date && date <= today ? date : ui.foodDate || today;
  ui.foodTab = "quick";
  ui.sheet = "food";
}
