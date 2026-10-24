// Transient UI state: which sheet is open, selection, demo states, toasts.
import { reactive } from "vue";
import type { Entry } from "./store";
import { today } from "./store";
import { nowHM } from "./lib/time";

export type Sheet = null | "chooser" | "food" | "weight" | "copy" | "group" | "accuracy";
export type FoodTab = "search" | "quick";
/** Hidden reviewer switch (Profile → Demo states). */
export type DemoState = "normal" | "onboarding" | "empty" | "lowacc" | "fresh" | "typo" | "loading" | "offline" | "unreachable" | "down" | "manual" | "goalreached";

export const ui = reactive({
  sheet: null as Sheet,
  foodTab: "search" as FoodTab,
  /** food id open in the detail view (or null for the list) */
  detailFoodId: null as string | null,
  /** S3: my-food editor inside the food sheet (null = closed; id = edit; seed = from Quick Add) */
  foodEditor: null as null | { id?: string; seed?: { name?: string; kcal?: number; p?: number; f?: number; c?: number }; ret?: "list" | "detail" },
  /** S3: search filter */
  foodFilter: "all" as "all" | "mine",
  /** when editing an existing log row */
  editEntry: null as Entry | null,
  date: today,
  /** null = "now" (resolved when saving) */
  time: null as string | null,
  /** ids added during the current food-sheet session (for "Save as group") */
  session: [] as string[],
  weightDate: today,
  /** demo: a value typed into the weight sheet on open (typo-guard demo) */
  weightDraft: null as string | null,
  /** S8: sheet to return to after the trend-accuracy sheet closes */
  accReturn: null as Sheet,
  /** Log multi-select */
  selecting: false,
  selected: [] as string[],
  /** entries to turn into a saved group (from the food-sheet session or Select mode) */
  groupDraft: [] as Entry[],
  /** sheet to return to after the group sheet closes */
  groupReturn: null as Sheet,
  copySingle: false,
  /** last row clicked in Select mode (shift-click range anchor) */
  anchor: null as string | null,
  demo: "normal" as DemoState,
  toast: null as null | { text: string; action?: { label: string; run: () => void }; id: number },
});

export function openChooser() { ui.sheet = "chooser"; }
export function openFood(opts: { date?: string; tab?: FoodTab } = {}) {
  ui.date = opts.date ?? today;
  ui.time = null;
  ui.foodTab = opts.tab ?? "search";
  ui.detailFoodId = null;
  ui.editEntry = null;
  ui.foodEditor = null;
  ui.foodFilter = "all";
  ui.session = [];
  ui.sheet = "food";
}
export function openEdit(e: Entry) {
  ui.date = e.date;
  ui.time = e.time;
  ui.editEntry = e;
  ui.foodEditor = null;
  ui.session = [];
  if (e.foodId) { ui.foodTab = "search"; ui.detailFoodId = e.foodId; }
  else { ui.foodTab = "quick"; ui.detailFoodId = null; }
  ui.sheet = "food";
}
export const entryTime = () => ui.time ?? nowHM();
export function openWeight(date = today) { ui.weightDate = date; ui.sheet = "weight"; }
export function closeSheet() { ui.sheet = null; }
/** S8: the low-accuracy dot explains itself in a small sheet; from the weight sheet it returns there. */
export function openAccuracy() { ui.accReturn = ui.sheet === "weight" ? "weight" : null; ui.sheet = "accuracy"; }
export function closeAccuracy() { ui.sheet = ui.accReturn; ui.accReturn = null; }
export function openGroupSheet(list: Entry[]) {
  ui.groupDraft = list.map((e) => ({ ...e }));
  ui.groupReturn = ui.sheet === "food" ? "food" : null;
  ui.sheet = "group";
}
/** single: opened from one row's Copy action, so closing it also leaves Select mode */
export function openCopy(single = false) { ui.copySingle = single; ui.sheet = "copy"; }

export function startSelect(id?: string) { ui.selecting = true; ui.selected = id ? [id] : []; }
export function endSelect() { ui.selecting = false; ui.selected = []; ui.anchor = null; }
export function toggleSelected(id: string) {
  const i = ui.selected.indexOf(id);
  if (i >= 0) ui.selected.splice(i, 1); else ui.selected.push(id);
}

let tid = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: { label: string; run: () => void }) {
  ui.toast = { text, action, id: ++tid };
  clearTimeout(timer);
  timer = setTimeout(() => (ui.toast = null), action ? 5000 : 2200);
}
