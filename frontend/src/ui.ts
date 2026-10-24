import { reactive } from "vue";
import { todayIso } from "./lib/dates";

export const ui = reactive({
  sheet: null as null | "weight" | "accuracy",
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
  toastTimer = window.setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null;
  }, action ? 5000 : 4000);
}

export function openWeight(): void {
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
}

export function openAdd(): void {
  toast("Food logging comes in a later update.");
}
