import { reactive } from "vue";

export const ui = reactive({
  sheet: null as null | "weight",
  toast: null as null | { id: number; text: string },
});

let toastTimer = 0;

export function toast(text: string): void {
  const id = Date.now();
  ui.toast = { id, text };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null;
  }, 4000);
}

export function openWeight(): void {
  ui.sheet = "weight";
}

export function closeSheet(): void {
  ui.sheet = null;
}

export function openAdd(): void {
  toast("Food logging comes in a later update.");
}
