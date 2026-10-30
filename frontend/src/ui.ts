import { reactive } from "vue";
import { todayIso } from "./lib/dates";

export const ui = reactive({
  sheet: null as null | "weight" | "accuracy" | "chooser" | "food",
  foodTab: "quick" as "search" | "quick",
  editEntryId: null as string | null,
  toast: null as null | { id: number; text: string; action?: { label: string; run: () => void } },
  weightDate: todayIso(),
  accReturn: null as null | "weight",
  keepWeightDraft: false,
});

let toastTimer = 0;

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

export function closeSheet(): void {
  ui.sheet = null;
  ui.accReturn = null;
  ui.keepWeightDraft = false;
  ui.editEntryId = null;
}

export function openAdd(): void {
  ui.editEntryId = null;
  ui.sheet = "chooser";
}

export function openFood(tab: "search" | "quick" = "quick"): void {
  ui.editEntryId = null;
  ui.foodTab = tab;
  ui.sheet = "food";
}

export function openEdit(id: string): void {
  ui.editEntryId = id;
  ui.foodTab = "quick";
  ui.sheet = "food";
}
