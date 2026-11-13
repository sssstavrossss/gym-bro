<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ApiError, createCustomFood, createServing, deleteServing, getFood, listMyFoods, listRecentFoods, searchFoods, searchOpenFoodFacts, ServerUnreachable, updateServing, type FoodSearchRow, type OffFoodRow, type RecentFood, type SavedGroup } from "../api";
import BottomSheet from "./BottomSheet.vue";
import FoodEditor from "./FoodEditor.vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import Segmented from "./Segmented.vue";
import TimeChip from "./TimeChip.vue";
import { dayMonth, todayInZone } from "../lib/dates";
import { focusField, primeKeyboard } from "../lib/focusField";
import { int } from "../lib/format";
import {
  amountError,
  amountLabel,
  defaultAmount,
  gramText,
  hasGramBasis,
  macrosForFood,
  normalizeUnit,
  parseAmount,
  macroFigure,
  per100Line,
  scaleStored,
  servingDefinitionError,
  servingName,
  unitsForEntry,
  unitsForFood,
  type OwnServing,
  type UnitChoice,
} from "../lib/foodAmount";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../lib/foodSearch";
import {
  addNeedsTime,
  amountForRecent,
  beginOffRequest,
  canAskOpenFoodFacts,
  finishOffRequest,
  idleOff,
  isMyFood,
  logTimeForAdd,
  missingKcalAction,
  missingKcalEditorSeed,
  missingKcalLead,
  myFoodsEmptyDetail,
  myFoodsEmptyTitle,
  offFailureCopy,
  packagedBesideLocal,
  quickAddName,
  withBrand,
  recentAddBody,
  recentEmptyDetail,
  recentEmptyTitle,
  recentHintKeys,
  recentHintTouch,
  recentSubtitle,
  sameAddTap,
  typeForLocalSearch,
} from "../lib/foodSheet";
import { quickAddFoodWrite } from "../lib/customFood";
import { kcalFromMacros, macroStatus } from "../lib/macros";
import { bindPick, clickPick } from "../lib/cleanTap";
import { afterInsertion, markWholeSelection, nextQuickInput, nextQuickNumber, tookWholeSelection } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";
import { deviceTimeZone, profile } from "../state/profile";
import { findEntry, log, removeEntries, removeEntry, saveQuickAdd, totalsOf, updateFoodAmount, updateQuickAdd, viewed, type LogEntry } from "../state/log";
import SavedGroups from "./SavedGroups.vue";
import RecipeList from "./RecipeList.vue";
import { canSaveGroup, groupTimeNote, matchingGroups, readdToast } from "../lib/groups";
import { canSaveRecipe, matchingRecipes, recipeFoodEntries } from "../lib/recipes";
import { deleteSavedGroup, loadGroups, readdSavedGroup, savedGroups } from "../state/groups";
import { loadRecipes, retireRecipe, savedRecipes } from "../state/recipes";
import { closeFoodLayer, closeSheet, openCopy, openGroupSheet, openRecipeCreate, openRecipeEdit, openRecipeFromEntries, openRecipeLog, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "food");
const editing = computed(() => findEntry(ui.editEntryId));
const foodToday = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const pastDay = computed(() => ui.foodDate !== foodToday.value);
const needTime = computed(() => addNeedsTime(ui.foodDate, foodToday.value, time.value, Boolean(editing.value)));
const editingFood = computed(() => (editing.value && editing.value.source !== "quick" ? editing.value : null));
const showEditor = computed(() => ui.foodEditor != null);
const showDetail = computed(() => Boolean(ui.detailFoodId || editingFood.value));
const sheetLabel = computed(() => {
  if (ui.foodEditor) return ui.foodEditor.id ? "Edit my food" : "New food";
  return editing.value ? "Edit food" : "Add food";
});

type Field = "kcal" | "p" | "f" | "c";
const qa = ref<Record<Field, string>>({ kcal: "", p: "", f: "", c: "" });
const replace = ref<Record<Field, boolean>>({ kcal: true, p: true, f: true, c: true });
const qName = ref("");
const active = ref<Field>("kcal");
const time = ref<string | null>(null);
const saveError = ref(false);
const formError = ref("");
const saving = ref(false);
const idempotencyKey = ref("");
const fields: { key: Field; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "p", label: "Protein", unit: "g" },
  { key: "f", label: "Fat", unit: "g" },
  { key: "c", label: "Carbs", unit: "g" },
];

const q = ref("");
const filter = ref<"all" | "mine" | "recipes">("all");
const mine = ref<FoodSearchRow[]>([]);
const qSave = ref(false);
const savedFoodId = ref<string | null>(null);
const savedFoodSig = ref("");
const results = ref<FoodSearchRow[]>([]);
const recents = ref<RecentFood[]>([]);
const off = ref(idleOff<FoodSearchRow>());
const searching = ref(false);
const searchError = ref("");
const hi = ref(0);
const justAdded = ref<string | null>(null);
const recentKeys = new Map<string, string>();
let lastTap = { id: "", at: 0 };
let justTimer = 0;
let recentGen = 0;
let detailGen = 0;
const searchEl = ref<HTMLInputElement | null>(null);
const searchFocused = ref(false);
const amountEl = ref<HTMLInputElement | null>(null);
const detailFood = ref<FoodSearchRow | null>(null);
const amountText = ref("100");
const unit = ref<UnitChoice["unit"]>("g");
const fresh = ref(true);
const foodChanged = ref(false);
const session = ref<{ id: string; name: string; kcal: number }[]>([]);
const justGroup = ref<string | null>(null);
const groupKeys = new Map<string, string>();
let searchGen = 0;
let searchTimer = 0;

const sessionKcal = computed(() => session.value.reduce((sum, row) => sum + row.kcal, 0));
const visibleGroups = computed(() => matchingGroups(savedGroups.list, q.value));
const visibleRecipes = computed(() => matchingRecipes(savedRecipes.list, q.value));
const sessionRecipeCount = computed(() => recipeFoodEntries(session.value.map((row) => findEntry(row.id)).filter((entry) => entry !== null)).length);
const groupNote = computed(() => groupTimeNote(needTime.value, pastDay.value, time.value));
const foodEntries = computed(() => {
  if (viewed.date === ui.foodDate) return viewed.entries;
  if (ui.foodDate === foodToday.value) return log.entries;
  return [];
});
const foodTotals = computed(() => totalsOf(foodEntries.value));
const foodTarget = computed(() => (viewed.date === ui.foodDate ? viewed.target : null));
const addVerb = computed(() => {
  if (editing.value) return "Save";
  if (needTime.value) return "Pick a time to add";
  if (pastDay.value && time.value) return `Add to ${dayMonth(ui.foodDate)} at ${time.value}`;
  if (time.value) return `Add at ${time.value}`;
  return "Add";
});

function num(key: Field): number {
  const raw = qa.value[key].trim().replace(",", ".");
  if (!raw || raw === ".") return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
const qKcalAuto = computed(() => Math.round(kcalFromMacros(num("p"), num("f"), num("c"))));
const qKcal = computed(() => (qa.value.kcal !== "" ? Math.round(num("kcal")) : qKcalAuto.value));

function typeInto(current: string, key: string, maxInt: number, decimals = 1): string {
  if (key === "⌫") return current.length <= 1 ? "" : current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  if (current.includes(".") && current.split(".")[1].length >= decimals) return current;
  if (!current.includes(".") && current.replace(/^0/, "").length >= maxInt) return current;
  return current === "0" ? key : current + key;
}
function armQuick(field: Field) {
  replace.value[field] = qa.value[field] !== "";
}
function onQuickFocus(field: Field) {
  const typing = active.value === field && !replace.value[field];
  active.value = field;
  if (typing) return;
  armQuick(field);
}
function onQuickBlur(field: Field) {
  armQuick(field);
}
function onQuickTap(field: Field) {
  if (active.value !== field) armQuick(active.value);
  active.value = field;
  armQuick(field);
}
function qKey(key: string) {
  const field = active.value;
  const armed = replace.value[field];
  qa.value[field] = nextQuickNumber(qa.value[field], key, armed, field === "kcal" ? 5 : 4);
  if (armed) replace.value[field] = false;
}
function qInput(key: Field, event: Event) {
  const input = event.target as HTMLInputElement;
  const armed = replace.value[key];
  afterInsertion(input, (raw) => {
    const value = nextQuickInput(qa.value[key], raw, armed && !tookWholeSelection(input), 6);
    qa.value[key] = value;
    if (input.value !== value) input.value = value;
    if (armed) replace.value[key] = false;
  });
}
function limitMessage(): string | null {
  const kcal = qa.value.kcal !== "" ? num("kcal") : qKcalAuto.value;
  if (kcal < 0 || kcal > 10000) return "Calories should be from 0 to 10,000.";
  if (num("p") < 0 || num("p") > 1000) return "Protein should be from 0 to 1,000 g.";
  if (num("f") < 0 || num("f") > 1000) return "Fat should be from 0 to 1,000 g.";
  if (num("c") < 0 || num("c") > 1000) return "Carbs should be from 0 to 1,000 g.";
  return null;
}
const qSaveNeedsName = computed(() => qSave.value && !qName.value.trim());
function fill(entry: LogEntry | null) {
  saveError.value = false;
  formError.value = "";
  saving.value = false;
  foodChanged.value = false;
  qSave.value = false;
  savedFoodId.value = null;
  savedFoodSig.value = "";
  replace.value = { kcal: true, p: true, f: true, c: true };
  if (entry && entry.source === "quick") {
    qName.value = entry.name === "Quick add" ? "" : entry.name;
    qa.value = {
      kcal: String(entry.kcal),
      p: String(entry.protein),
      f: String(entry.fat),
      c: String(entry.carbs),
    };
    time.value = entry.time;
    idempotencyKey.value = "";
    return;
  }
  qName.value = "";
  qa.value = { kcal: "", p: "", f: "", c: "" };
  active.value = "kcal";
  time.value = entry?.time ?? null;
  idempotencyKey.value = "";
}

const shownFood = computed(() => detailFood.value);
const units = computed(() => {
  const entry = editing.value;
  if (entry?.source === "recipe" && (entry.grams == null || entry.grams <= 0)) {
    return [{ unit: "portion", label: "portion", gramsEach: null }];
  }
  if (editingFood.value) return unitsForEntry(editingFood.value);
  return shownFood.value ? unitsForFood(shownFood.value) : [];
});
const amountNumber = computed(() => parseAmount(amountText.value));
const preview = computed(() => {
  if (editingFood.value) return scaleStored(editingFood.value, amountNumber.value, unit.value);
  if (shownFood.value) return macrosForFood(shownFood.value, amountNumber.value, unit.value);
  return { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: null as number | null };
});
const isCount = computed(() => unit.value !== "g" && unit.value !== "ml");
const canAddServing = computed(() => Boolean(shownFood.value && hasGramBasis(shownFood.value) && !editingFood.value));
const ownServings = computed(() => (shownFood.value?.servings ?? []).filter((row) => row.grams > 0 && servingName(row.name)));
const svOpen = ref(false);
const svName = ref("");
const svGrams = ref("");
const svEditId = ref<string | null>(null);
const savingServing = ref(false);
const servingDraftError = computed(() => servingDefinitionError(svName.value, parseAmount(svGrams.value)));
const unitWord = computed(() => amountLabel(amountNumber.value || 0, unit.value).replace(/^[\d.]+ /, ""));
const gramsEach = computed(() => units.value.find((item) => item.unit === unit.value)?.gramsEach ?? null);
const quickAmounts = computed(() => (unit.value === "g" ? [100, 150, 200] : unit.value === "ml" ? [100, 250, 500] : [0.5, 1, 2, 3]));
const detailTitle = computed(() => detailFood.value?.name ?? editingFood.value?.name ?? "");
const per100 = computed(() => {
  if (shownFood.value && !editingFood.value) return per100Line(shownFood.value);
  const entry = editingFood.value;
  if (!entry) return "";
  if (entry.source === "recipe" && entry.unit === "portion") {
    const each = entry.amount || 1;
    return `per portion · ${int(entry.kcal / each)} kcal · P${macroFigure(entry.protein / each)} F${macroFigure(entry.fat / each)} C${macroFigure(entry.carbs / each)}`;
  }
  if (entry.grams && entry.grams > 0) {
    const factor = 100 / entry.grams;
    return `per 100 ${entry.unit === "ml" ? "ml" : "g"} · ${int(entry.kcal * factor)} kcal · P${macroFigure(entry.protein * factor)} F${macroFigure(entry.fat * factor)} C${macroFigure(entry.carbs * factor)}`;
  }
  const each = entry.amount || 1;
  return `per serving · ${int(entry.kcal / each)} kcal · P${macroFigure(entry.protein / each)} F${macroFigure(entry.fat / each)} C${macroFigure(entry.carbs / each)}`;
});
const previewItems = computed(() => [
  { label: "KCAL", value: preview.value.kcal },
  { label: "PROTEIN", value: preview.value.protein },
  { label: "FAT", value: preview.value.fat },
  { label: "CARBS", value: preview.value.carbs },
]);
const after = computed(() => {
  const goal = foodTarget.value ?? (ui.foodDate === foodToday.value ? profile.targets : null);
  if (!goal || !keyboardEntry.value) return null;
  const totals = foodTotals.value;
  const old = editing.value ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const next = preview.value;
  return [
    { k: "kcal" as const, label: "Calories", v: totals.kcal - old.kcal + next.kcal, tgt: goal.kcal, unit: "kcal" },
    { k: "p" as const, label: "Protein", v: totals.p - old.protein + next.protein, tgt: goal.protein, unit: "g" },
    { k: "f" as const, label: "Fat", v: totals.f - old.fat + next.fat, tgt: goal.fat, unit: "g" },
    { k: "c" as const, label: "Carbs", v: totals.c - old.carbs + next.carbs, tgt: goal.carbs, unit: "g" },
  ];
});

function rowSub(food: FoodSearchRow): string {
  const english = food.nameEn && food.nameEn.localeCompare(food.name, undefined, { sensitivity: "accent" }) !== 0
    ? `${food.nameEn} · `
    : "";
  return withBrand(food.brand, english + per100Line(food));
}
const detailIsMine = computed(() => (shownFood.value ? isMyFood(shownFood.value) : false));

function resetServingForm() {
  svOpen.value = false;
  svName.value = "";
  svGrams.value = "";
  svEditId.value = null;
}
function showFood(food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  const start = preset ? amountForRecent(food, preset.amount, preset.unit) : defaultAmount(food);
  ui.detailFoodId = food.id;
  detailFood.value = food;
  unit.value = start.unit;
  amountText.value = start.amount;
  fresh.value = true;
  foodChanged.value = false;
  formError.value = "";
  saveError.value = false;
  idempotencyKey.value = "";
  resetServingForm();
}
function pickFood(event: MouseEvent, food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  clickPick(event, () => { void openFoodRow(food, preset); });
}
function pressFood(event: PointerEvent, food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  bindPick(event, () => { void openFoodRow(food, preset); });
}
async function openFoodRow(food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  primeKeyboard();
  const gen = ++detailGen;
  let current = food;
  if (food.source === "off") {
    try {
      current = { ...food, ...(await getFood(food.id)) };
    } catch {
      current = food;
    }
  }
  if (gen !== detailGen) return;
  showFood(current, preset);
}
function back() {
  const editor = ui.foodEditor;
  if (editor) {
    closeFoodLayer();
    if (editor.ret !== "detail") detailFood.value = null;
    formError.value = "";
    return;
  }
  if (editing.value) {
    closeSheet();
    return;
  }
  ui.detailFoodId = null;
  detailFood.value = null;
  formError.value = "";
}
function openNewFood(seedName?: string) {
  primeKeyboard();
  ui.foodEditor = { seed: seedName ? { name: seedName } : undefined, ret: "list" };
}
function openMissingEditor() {
  primeKeyboard();
  const seed = missingKcalEditorSeed(q.value);
  ui.foodEditor = { seed: seed ?? undefined, ret: "list" };
}
function editMine(food: FoodSearchRow, from: "list" | "detail") {
  primeKeyboard();
  ui.foodEditor = { id: food.id, ret: from };
}
function openSeedEditor() {
  primeKeyboard();
  ui.foodEditor = {
    seed: {
      name: qName.value.trim(),
      kcal: qKcal.value,
      protein: num("p"),
      fat: num("f"),
      carbs: num("c"),
    },
    ret: "list",
  };
}
function setUnit(next: UnitChoice) {
  if (next.unit === unit.value) return;
  if ((unit.value === "g" || unit.value === "ml") && (next.unit === "g" || next.unit === "ml")) {
    unit.value = next.unit;
    fresh.value = true;
    formError.value = "";
    return;
  }
  const current = units.value.find((item) => item.unit === unit.value);
  const grams = current?.gramsEach == null ? amountNumber.value : amountNumber.value * current.gramsEach;
  unit.value = next.unit;
  fresh.value = true;
  formError.value = "";
  if (next.gramsEach == null || next.gramsEach === 0) {
    amountText.value = "1";
    return;
  }
  if (next.unit === "g" || next.unit === "ml") {
    amountText.value = String(Math.round(grams || next.gramsEach));
    return;
  }
  const count = grams / next.gramsEach;
  const halves = Math.round(count * 2) / 2;
  const snapped = count >= 0.5 && Math.abs(count * 2 - Math.round(count * 2)) < 0.01 ? halves : 1;
  amountText.value = String(snapped);
}
function setAmount(value: number) {
  amountText.value = String(value);
  fresh.value = false;
  formError.value = "";
}
function amountKey(key: string) {
  const maxInt = unit.value === "g" || unit.value === "ml" ? 5 : 2;
  const decimals = isCount.value ? 2 : 1;
  if (fresh.value && key !== ".") {
    amountText.value = key === "⌫" ? "0" : key;
    fresh.value = false;
    return;
  }
  fresh.value = false;
  const next = typeInto(amountText.value === "0" && key !== "⌫" && key !== "." ? "0" : amountText.value, key, maxInt, decimals);
  amountText.value = next === "" ? "0" : next;
}
function queueSearchBlur() {
  window.setTimeout(() => { searchFocused.value = false; }, 0);
}
function blurSearch() {
  if (!searchFocused.value) return;
  searchEl.value?.blur();
}
function amountInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const replace = fresh.value;
  afterInsertion(input, (raw) => {
    let text = replace && !tookWholeSelection(input) ? nextQuickInput(amountText.value, raw, true, 8) : raw;
    fresh.value = false;
    text = text.replace(",", ".").replace(/[^0-9.]/g, "");
    const decimals = isCount.value ? 2 : 1;
    const maxInt = unit.value === "g" || unit.value === "ml" ? 5 : 2;
    const [whole, fraction] = text.split(".");
    const value = fraction === undefined ? (whole ?? "").slice(0, maxInt) : `${(whole ?? "").slice(0, maxInt)}.${fraction.slice(0, decimals)}`;
    amountText.value = value;
    if (input.value !== value) input.value = value;
  });
}
const trimmedQuery = computed(() => q.value.trim());
const mineListed = computed(() => {
  const needle = trimmedQuery.value.toLowerCase();
  return mine.value.filter((food) => !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle));
});
const listed = computed(() => {
  if (filter.value === "mine") return mineListed.value;
  return trimmedQuery.value ? results.value : recents.value;
});
const offCopy = computed(() => (
  off.value.status === "rate_limited" || off.value.status === "unavailable" ? offFailureCopy(off.value.status) : null
));
const showNoMatch = computed(() => Boolean(
  trimmedQuery.value
  && !searching.value
  && !searchError.value
  && !results.value.length
  && !visibleRecipes.value.length
  && !off.value.results.length
  && off.value.status !== "loading"
  && !offCopy.value
  && off.value.missingKcal === 0,
));
const showOffButton = computed(() => canAskOpenFoodFacts(q.value) && off.value.status === "idle" && !searchError.value);

function isRecent(food: FoodSearchRow): food is RecentFood {
  return typeof (food as RecentFood).amount === "number" && typeof (food as RecentFood).unit === "string" && !trimmedQuery.value;
}
function searchKey(event: KeyboardEvent) {
  if (filter.value === "recipes") {
    const rows = visibleRecipes.value;
    if (!rows.length || !keyboardEntry.value) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      hi.value = (hi.value + 1) % rows.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      hi.value = (hi.value - 1 + rows.length) % rows.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const recipe = rows[Math.min(hi.value, rows.length - 1)];
      if (recipe) openRecipeLog(recipe.id);
    }
    return;
  }
  const rows = listed.value;
  const count = rows.length;
  if (!count || !keyboardEntry.value) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    hi.value = (hi.value + 1) % count;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    hi.value = (hi.value - 1 + count) % count;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const food = rows[Math.min(hi.value, count - 1)];
    if (!food) return;
    if (event.shiftKey && (isRecent(food) || filter.value === "mine")) {
      if (isRecent(food)) void addRecent(food);
      else addListed(food);
      return;
    }
    if (!event.shiftKey) {
      void openFoodRow(food, isRecent(food) ? { amount: food.amount, unit: food.unit } : undefined);
    }
  }
}
function knownOff(rows: OffFoodRow[]): FoodSearchRow[] {
  return rows.filter((row): row is FoodSearchRow => Boolean(row.id));
}
async function loadMine() {
  try {
    const body = await listMyFoods();
    mine.value = body.foods;
  } catch {
    mine.value = [];
  }
}
function listedPreset(food: FoodSearchRow) {
  const recent = recents.value.find((row) => row.id === food.id);
  return recent ? amountForRecent(food, recent.amount, recent.unit) : defaultAmount(food);
}
function addListed(food: FoodSearchRow) {
  const picked = listedPreset(food);
  void addRecent({ ...food, amount: Number(picked.amount), unit: picked.unit });
}
async function onFoodSaved(food: FoodSearchRow, created: boolean) {
  const ret = ui.foodEditor?.ret;
  ui.foodEditor = null;
  await loadMine();
  if (created) {
    toast(`Saved ${food.name} to My foods`);
    showFood(food);
    return;
  }
  toast(`Updated ${food.name} · past entries unchanged`);
  if (ret === "detail") showFood(food);
  else if (trimmedQuery.value && filter.value === "all") void runSearch(trimmedQuery.value);
}
async function onFoodDeleted(food: FoodSearchRow) {
  ui.foodEditor = null;
  ui.detailFoodId = null;
  detailFood.value = null;
  await loadMine();
  if (trimmedQuery.value && filter.value === "all") void runSearch(trimmedQuery.value);
  toast(`Deleted ${food.name} · past entries kept`);
}
async function loadRecents() {
  const gen = ++recentGen;
  try {
    const body = await listRecentFoods();
    if (gen !== recentGen) return;
    recents.value = body.foods;
  } catch {
    if (gen === recentGen) recents.value = [];
  }
}
async function askOff() {
  const next = beginOffRequest({ ...off.value, query: q.value });
  if (!next) return;
  off.value = next;
  const asked = q.value.trim();
  try {
    const body = await searchOpenFoodFacts(asked);
    off.value = finishOffRequest(off.value, {
      query: asked,
      status: body.openFoodFacts.status,
      missingKcal: body.openFoodFacts.missingKcal,
      results: packagedBesideLocal(results.value, knownOff(body.openFoodFacts.results)),
    });
  } catch {
    off.value = finishOffRequest(off.value, { query: asked, status: "unavailable", missingKcal: 0, results: [] });
  }
}
function useQuickAdd() {
  qName.value = quickAddName(qName.value, q.value);
  ui.foodTab = "quick";
}
async function addRecent(food: RecentFood) {
  if (saving.value) return;
  if (needTime.value) {
    formError.value = "Pick a time to add";
    return;
  }
  const now = performance.now();
  if (lastTap.id === food.id && sameAddTap(lastTap.at, now)) return;
  lastTap = { id: food.id, at: now };
  const picked = amountForRecent(food, food.amount, food.unit);
  const amount = Number(picked.amount);
  const macros = macrosForFood(food, amount, picked.unit);
  let key = recentKeys.get(food.id);
  if (!key) {
    key = crypto.randomUUID();
    recentKeys.set(food.id, key);
  }
  const built = recentAddBody({
    foodId: food.id,
    name: food.name,
    amount,
    unit: picked.unit,
    kcal: macros.kcal,
    protein: macros.protein,
    fat: macros.fat,
    carbs: macros.carbs,
    date: ui.foodDate,
    today: foodToday.value,
    timeZone: deviceTimeZone(),
    pickedTime: time.value,
    idempotencyKey: key,
  });
  if (!built.ok) {
    formError.value = "Pick a time to add";
    lastTap = { id: "", at: 0 };
    return;
  }
  saving.value = true;
  formError.value = "";
  try {
    const result = await saveQuickAdd(built.body);
    if (!result.ok) {
      lastTap = { id: "", at: 0 };
      saveError.value = result.unreachable === true;
      formError.value = result.unreachable ? "" : (result.message ?? "");
      return;
    }
    recentKeys.delete(food.id);
    toast(`Added ${amountLabel(result.entry.amount, result.entry.unit || picked.unit)} ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
    noteSession(result.entry);
    justAdded.value = food.id;
    window.clearTimeout(justTimer);
    justTimer = window.setTimeout(() => {
      if (justAdded.value === food.id) justAdded.value = null;
    }, 1200);
    saveError.value = false;
    void loadRecents();
  } finally {
    saving.value = false;
  }
}
async function runSearch(trimmed: string) {
  const gen = ++searchGen;
  searching.value = true;
  searchError.value = "";
  try {
    const body = await searchFoods(trimmed);
    if (!acceptSearchResult(gen, trimmed, searchGen, q.value)) return;
    results.value = body.foods;
  } catch (error) {
    if (gen !== searchGen) return;
    results.value = [];
    searchError.value = error instanceof ServerUnreachable
      ? "server unreachable, try again"
      : error instanceof ApiError ? error.message : "Couldn't search foods.";
  } finally {
    if (gen === searchGen) searching.value = false;
  }
}
function scheduleSearch(value: string) {
  window.clearTimeout(searchTimer);
  hi.value = 0;
  const plan = preparedSearch(value);
  if (plan.kind !== "query") {
    searchGen += 1;
    results.value = [];
    searching.value = false;
    searchError.value = plan.kind === "hint" ? plan.message : "";
    return;
  }
  searching.value = true;
  const trimmed = plan.query;
  searchTimer = window.setTimeout(() => { void runSearch(trimmed); }, searchDebounceMs);
}
async function prepareEdit(entry: LogEntry) {
  const standard = normalizeUnit(entry.unit);
  const named = standard ? null : servingName(entry.unit);
  const kind = standard ?? (named ?? (entry.grams == null ? "serving" : "g"));
  unit.value = kind;
  amountText.value = String(entry.amount);
  fresh.value = true;
  foodChanged.value = false;
  detailFood.value = null;
  if (!entry.foodId) {
    foodChanged.value = entry.source !== "recipe";
    return;
  }
  try {
    const food = await getFood(entry.foodId);
    if (ui.editEntryId !== entry.id) return;
    detailFood.value = food;
    const implied = entry.grams && entry.grams > 0 ? (entry.kcal / entry.grams) * 100 : entry.kcal / (entry.amount || 1);
    foodChanged.value = Math.abs(implied - food.kcalPer100) > 0.05;
  } catch {
    if (ui.editEntryId === entry.id) foodChanged.value = true;
  }
}
function focusFor() {
  if (ui.sheet !== "food" || ui.foodEditor) return;
  void nextTick(() => {
    const field = showDetail.value ? amountEl.value : ui.foodTab === "search" ? searchEl.value : null;
    if (field) focusField(field);
  });
}
function onAddTabPointer(event: PointerEvent) {
  const label = (event.target as HTMLElement).closest("button")?.textContent?.trim();
  const next = label === "Quick Add" ? "quick" : label === "Search" ? "search" : null;
  if (next && next !== ui.foodTab) primeKeyboard();
}
watch(q, (value) => {
  if (filter.value === "mine" || filter.value === "recipes") {
    window.clearTimeout(searchTimer);
    searchGen += 1;
    searching.value = false;
    searchError.value = "";
    hi.value = 0;
    return;
  }
  scheduleSearch(value);
  off.value = typeForLocalSearch(off.value, value);
});
watch(filter, (value) => {
  hi.value = 0;
  if (value === "mine" || value === "recipes") {
    window.clearTimeout(searchTimer);
    searchGen += 1;
    searching.value = false;
    return;
  }
  scheduleSearch(q.value);
  off.value = typeForLocalSearch(off.value, q.value);
});
watch(results, (rows) => {
  if (!off.value.results.length) return;
  off.value = { ...off.value, results: packagedBesideLocal(rows, off.value.results) };
});
watch(() => [ui.sheet, ui.detailFoodId, ui.foodTab, showDetail.value], focusFor);
watch(open, (isOpen) => {
  if (!isOpen) return;
  if (ui.resumeFood) {
    ui.resumeFood = false;
    void loadGroups();
    void loadRecipes();
    return;
  }
  q.value = "";
  results.value = [];
  searchError.value = "";
  searching.value = false;
  session.value = [];
  off.value = idleOff();
  filter.value = "all";
  detailFood.value = null;
  resetServingForm();
  if (!editingFood.value) ui.detailFoodId = null;
  fill(editing.value);
  if (editingFood.value) {
    ui.detailFoodId = editingFood.value.foodId;
    void prepareEdit(editingFood.value);
  } else {
    void loadRecents();
    void loadMine();
    void loadGroups();
    void loadRecipes();
  }
});

function noteSession(entry: { id: string; name: string; kcal: number }) {
  session.value.push({ id: entry.id, name: entry.name, kcal: entry.kcal });
}
function saveSessionGroup() {
  if (!canSaveGroup(session.value.length)) return;
  openGroupSheet(session.value.map((row) => row.id), "food");
}
function saveSessionRecipe() {
  if (!canSaveRecipe(sessionRecipeCount.value)) return;
  openRecipeFromEntries(session.value.map((row) => row.id), "food");
}
async function removeRecipe(recipe: { id: string; name: string }) {
  if (saving.value) return;
  saving.value = true;
  const removed = await retireRecipe(recipe.id);
  saving.value = false;
  if (removed) toast(`Deleted ${recipe.name} · past logs kept`);
  else toast("Couldn't delete that recipe.");
}
async function addGroup(group: SavedGroup) {
  if (saving.value) return;
  const when = logTimeForAdd(ui.foodDate, foodToday.value, time.value);
  if (!when.ok) {
    formError.value = "Pick a time to add";
    return;
  }
  let key = groupKeys.get(group.id);
  if (!key) {
    key = crypto.randomUUID();
    groupKeys.set(group.id, key);
  }
  saving.value = true;
  formError.value = "";
  const result = await readdSavedGroup(group.id, {
    localDate: ui.foodDate,
    timeZone: deviceTimeZone(),
    time: when.time,
    idempotencyKey: key,
  });
  saving.value = false;
  if (!result.ok) {
    groupKeys.delete(group.id);
    formError.value = result.message;
    return;
  }
  groupKeys.delete(group.id);
  const addedKcal = result.entries.reduce((sum, entry) => sum + entry.kcal, 0);
  for (const entry of result.entries) noteSession(entry);
  justGroup.value = group.id;
  window.setTimeout(() => {
    if (justGroup.value === group.id) justGroup.value = null;
  }, 1200);
  toast(readdToast(group.name, result.entries.length, addedKcal, result.notice), result.entries.length ? {
    label: "Undo",
    run: () => {
      const ids = new Set(result.entries.map((entry) => entry.id));
      session.value = session.value.filter((row) => !ids.has(row.id));
      void removeEntries(result.entries, { announce: false });
    },
  } : undefined);
}
async function removeGroup(group: SavedGroup) {
  if (saving.value) return;
  saving.value = true;
  const removed = await deleteSavedGroup(group.id);
  saving.value = false;
  if (removed) toast(`Deleted group ${group.name}`);
}

async function addQuick() {
  if (saving.value) return;
  if (!editing.value && needTime.value) {
    formError.value = "Pick a time to add";
    saveError.value = false;
    return;
  }
  const limit = limitMessage();
  if (limit) {
    formError.value = limit;
    saveError.value = false;
    return;
  }
  if (!qKcal.value) return;
  const when = logTimeForAdd(ui.foodDate, foodToday.value, time.value);
  if (!when.ok) {
    formError.value = "Pick a time to add";
    saveError.value = false;
    return;
  }
  formError.value = "";
  saving.value = true;
  const name = qName.value.trim() || "Quick add";
  const values = {
    name,
    kcal: qa.value.kcal !== "" ? num("kcal") : qKcalAuto.value,
    protein: num("p"),
    fat: num("f"),
    carbs: num("c"),
    time: when.time,
  };
  try {
    if (editing.value) {
      const result = await updateQuickAdd(editing.value.id, values);
      if (!result.ok) {
        saveError.value = result.unreachable === true;
        formError.value = result.unreachable ? "" : (result.message ?? "");
        return;
      }
      toast(`Updated ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
      closeSheet();
      return;
    }
    if (qSave.value) {
      const built = quickAddFoodWrite(values);
      if (!built.ok) {
        formError.value = built.message;
        return;
      }
      const signature = `${values.name}|${values.kcal}|${values.protein}|${values.fat}|${values.carbs}`;
      if (savedFoodSig.value !== signature) {
        savedFoodId.value = null;
        savedFoodSig.value = signature;
      }
      if (!savedFoodId.value) {
        try {
          const food = await createCustomFood(built.payload);
          savedFoodId.value = food.id;
        } catch (error) {
          if (error instanceof ServerUnreachable) saveError.value = true;
          else formError.value = error instanceof ApiError ? error.message : "Couldn't save that food.";
          return;
        }
      }
    }
    if (!idempotencyKey.value) idempotencyKey.value = crypto.randomUUID();
    const result = await saveQuickAdd({
      idempotencyKey: idempotencyKey.value,
      localDate: ui.foodDate,
      timeZone: deviceTimeZone(),
      ...values,
      ...(qSave.value && savedFoodId.value ? { foodId: savedFoodId.value, amount: 1, unit: "serving" } : {}),
    });
    if (!result.ok) {
      saveError.value = result.unreachable === true;
      formError.value = result.unreachable ? "" : (result.message ?? "");
      return;
    }
    const savedMine = qSave.value;
    toast(savedMine
      ? `Added ${result.entry.name} · ${int(result.entry.kcal)} kcal · saved to My foods`
      : `Added ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
    noteSession(result.entry);
    if (savedMine) void loadMine();
    const held = pastDay.value ? time.value : null;
    fill(null);
    if (held) time.value = held;
    saveError.value = false;
    ui.foodTab = "search";
  } finally {
    saving.value = false;
  }
}

function toggleServingForm() {
  if (!svOpen.value) primeKeyboard();
  svOpen.value = !svOpen.value;
  svEditId.value = null;
  svName.value = "";
  svGrams.value = "";
}
function beginEditServing(row: OwnServing) {
  primeKeyboard();
  svOpen.value = true;
  svEditId.value = row.id;
  svName.value = row.name;
  svGrams.value = gramText(row.grams);
}
function applyServings(foodId: string, servings: OwnServing[]) {
  const next = <T extends { id: string }>(food: T): T => food.id === foodId ? { ...food, servings } : food;
  if (detailFood.value?.id === foodId) detailFood.value = next(detailFood.value);
  recents.value = recents.value.map(next);
  results.value = results.value.map(next);
  mine.value = mine.value.map(next);
  if (off.value.results.some((row) => row.id === foodId)) {
    off.value = { ...off.value, results: off.value.results.map((row) => row.id === foodId ? { ...row, servings } : row) };
  }
}
function servingsOf(foodId: string): OwnServing[] {
  const found = detailFood.value?.id === foodId
    ? detailFood.value
    : recents.value.find((row) => row.id === foodId)
      ?? results.value.find((row) => row.id === foodId)
      ?? mine.value.find((row) => row.id === foodId);
  return found?.servings ?? [];
}
function rememberServing(foodId: string, saved: OwnServing) {
  const current = servingsOf(foodId);
  const next = [
    ...current.filter((row) => row.id !== saved.id && row.name.localeCompare(saved.name, undefined, { sensitivity: "accent" }) !== 0),
    saved,
  ].sort((a, b) => a.name.localeCompare(b.name));
  applyServings(foodId, next);
}
async function saveServing() {
  const food = detailFood.value;
  if (!food || savingServing.value) return;
  const grams = parseAmount(svGrams.value);
  const error = servingDefinitionError(svName.value, grams);
  if (error) {
    formError.value = error;
    return;
  }
  const name = servingName(svName.value);
  if (!name) return;
  const sameName = (food.servings ?? []).find((row) => row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
  const targetId = svEditId.value ?? sameName?.id ?? null;
  savingServing.value = true;
  formError.value = "";
  try {
    const saved = targetId
      ? await updateServing(food.id, targetId, { name, grams })
      : await createServing(food.id, { name, grams });
    rememberServing(food.id, saved);
    unit.value = saved.name;
    amountText.value = "1";
    fresh.value = true;
    resetServingForm();
    toast(`Saved 1 ${saved.name} = ${gramText(saved.grams)} g for ${food.name} · only you see it`);
  } catch (error) {
    if (error instanceof ServerUnreachable) saveError.value = true;
    else formError.value = error instanceof ApiError ? error.message : "Couldn't save that serving.";
  } finally {
    savingServing.value = false;
  }
}
async function restoreServing(foodId: string, name: string, grams: number) {
  try {
    const saved = await createServing(foodId, { name, grams });
    rememberServing(foodId, saved);
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : "Couldn't restore that serving.";
  }
}
async function dropServing(row: OwnServing) {
  const food = detailFood.value;
  if (!food || savingServing.value) return;
  savingServing.value = true;
  formError.value = "";
  try {
    await deleteServing(food.id, row.id);
    applyServings(food.id, (food.servings ?? []).filter((item) => item.id !== row.id));
    if (servingName(unit.value)?.localeCompare(row.name, undefined, { sensitivity: "accent" }) === 0) {
      const total = Math.round(amountNumber.value * row.grams);
      unit.value = "g";
      amountText.value = String(total > 0 ? total : 100);
      fresh.value = true;
    }
    if (svEditId.value === row.id) resetServingForm();
    toast(`Removed serving “${row.name}”`, {
      label: "Undo",
      run: () => { void restoreServing(food.id, row.name, row.grams); },
    });
  } catch (error) {
    if (error instanceof ServerUnreachable) saveError.value = true;
    else formError.value = error instanceof ApiError ? error.message : "Couldn't remove that serving.";
  } finally {
    savingServing.value = false;
  }
}
async function addDetail() {
  if (saving.value) return;
  if (!editingFood.value && needTime.value) {
    formError.value = "Pick a time to add";
    saveError.value = false;
    return;
  }
  const limit = amountError(amountNumber.value, unit.value);
  if (limit) {
    formError.value = limit;
    saveError.value = false;
    return;
  }
  formError.value = "";
  const when = editingFood.value ? null : logTimeForAdd(ui.foodDate, foodToday.value, time.value);
  if (when && !when.ok) {
    formError.value = "Pick a time to add";
    saveError.value = false;
    return;
  }
  saving.value = true;
  const previewNow = preview.value;
  try {
    if (editingFood.value) {
      const result = await updateFoodAmount(editingFood.value.id, {
        amount: amountNumber.value,
        unit: unit.value,
        time: time.value,
      });
      if (!result.ok) {
        saveError.value = result.unreachable === true;
        formError.value = result.unreachable ? "" : (result.message ?? "");
        return;
      }
      toast(`Updated ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
      closeSheet();
      return;
    }
    const food = detailFood.value;
    if (!food || !when || !when.ok) return;
    if (!idempotencyKey.value) idempotencyKey.value = crypto.randomUUID();
    const result = await saveQuickAdd({
      idempotencyKey: idempotencyKey.value,
      localDate: ui.foodDate,
      timeZone: deviceTimeZone(),
      time: when.time,
      name: food.name,
      kcal: previewNow.kcal,
      protein: previewNow.protein,
      fat: previewNow.fat,
      carbs: previewNow.carbs,
      foodId: food.id,
      amount: amountNumber.value,
      unit: unit.value,
    });
    if (!result.ok) {
      saveError.value = result.unreachable === true;
      formError.value = result.unreachable ? "" : (result.message ?? "");
      return;
    }
    toast(`Added ${amountLabel(result.entry.amount, result.entry.unit || unit.value)} ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
    noteSession(result.entry);
    ui.detailFoodId = null;
    detailFood.value = null;
    q.value = "";
    idempotencyKey.value = "";
    void loadRecents();
    saveError.value = false;
    formError.value = "";
  } finally {
    saving.value = false;
  }
}

function copyEdited() {
  const entry = editing.value;
  if (!entry || saving.value) return;
  ui.selected = [entry.id];
  ui.anchor = entry.id;
  openCopy(true);
}

async function deleteEdited() {
  const entry = editing.value;
  if (!entry || saving.value) return;
  saving.value = true;
  const removed = await removeEntry(entry);
  saving.value = false;
  if (removed) closeSheet();
}
</script>

<template>
  <BottomSheet :open="open" :label="sheetLabel" full @close="closeSheet">
    <template #header>
      <div class="toast-pad">
      <div class="row hdr">
        <button v-if="showDetail || showEditor" type="button" class="cbtn"  aria-label="Back" @click="back">
          <Icon name="left" :size="18" />
        </button>
        <h2 v-else-if="!searchFocused" class="t-head">{{ editing ? "Edit food" : "Add food" }}</h2>
        <span class="grow" />
        <TimeChip v-if="!showEditor && !searchFocused" v-model="time" :date="ui.foodDate" :today="foodToday" :allow-now="!pastDay && !editing" />
        <button type="button" class="cbtn"  aria-label="Close" @click="closeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
      <p v-if="needTime && !showEditor" class="needt t-label" role="status">
        <Icon name="clock" :size="14" :sw="2.2" /> Logging to {{ dayMonth(ui.foodDate) }} — pick the time you ate it.
      </p>
      <Segmented v-if="!showDetail && !editing && !showEditor && !searchFocused" v-model="ui.foodTab" label="Add food" :options="[{ value: 'search', label: 'Search' }, { value: 'quick', label: 'Quick Add' }]" @pointerdown="onAddTabPointer" />
      </div>
    </template>

    <div v-if="showEditor && ui.foodEditor" class="list">
      <FoodEditor :key="ui.foodEditor.id ?? 'new'" :edit-id="ui.foodEditor.id" :seed="ui.foodEditor.seed" :namesakes="mine" @saved="onFoodSaved" @deleted="onFoodDeleted" @cancel="back" />
    </div>

    <div v-else-if="showDetail" class="body">
      <div class="col center gap2">
        <h3 class="t-head dname">{{ detailTitle }}</h3>
        <span class="row gap6 t-label c2 wrapc">
          <span v-if="detailIsMine" class="mine t-capn"><Icon name="lock" :size="10" :sw="2.4" /> my food</span>
          <span v-if="detailFood?.brand">{{ detailFood.brand }} ·</span>
          <span>{{ per100 }}</span>
          <button v-if="detailIsMine && !editing" type="button" class="linkbtn t-label" @click="detailFood && editMine(detailFood, 'detail')">Edit</button>
        </span>
        <span v-if="editingFood && foodChanged" class="t-capn c2">Using the values it was logged with — this food has changed since.</span>
      </div>
      <div class="col center gap8">
        <div class="base">
          <input ref="amountEl" v-autofocus :value="amountText" data-replace="1" class="t-dl num ginput" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Amount in ${unit}`"
            @beforeinput="markWholeSelection" @focus="fresh = true" @input="amountInput" @keydown.enter.prevent="addDetail" />
          <span class="t-head c2">{{ unitWord }}</span>
        </div>
        <span v-if="isCount && preview.grams != null && gramsEach" class="t-label c2" aria-live="polite">= {{ int(preview.grams) }} g · 1 {{ unit }} = {{ gramsEach }} g</span>
        <div class="row units">
          <div class="unit-radios" role="radiogroup" aria-label="Unit">
            <button v-for="choice in units" :key="choice.unit" type="button" role="radio" class="uchip t-label" :class="{ on: choice.unit === unit }" :aria-checked="choice.unit === unit" @click="setUnit(choice)">
              {{ choice.label }}<span v-if="choice.gramsEach && choice.unit !== 'g' && choice.unit !== 'ml' && !choice.named" class="ug"> · {{ choice.gramsEach }} g</span><span v-if="choice.named" class="sr-only"> your serving</span>
            </button>
          </div>
          <button v-if="canAddServing" type="button" class="uchip add t-label" :aria-expanded="svOpen" @click="toggleServingForm"><Icon name="plus" :size="14" :sw="2.4" /> Serving</button>
        </div>
        <div v-if="svOpen" class="svform col">
          <div class="row gap8 wrapc">
            <span class="t-label">1</span>
            <input v-model="svName" v-autofocus class="sinp t-body" type="text" maxlength="16" autocomplete="off" aria-label="Serving name" placeholder="slice" />
            <span class="t-label">=</span>
            <input v-model="svGrams" class="sinp t-body num" inputmode="decimal" autocomplete="off" aria-label="Grams in one serving" placeholder="35" @keydown.enter.prevent="saveServing" />
            <span class="t-label c2">g</span>
            <button type="button" class="chip on t-label" :disabled="Boolean(servingDraftError) || savingServing" @click="saveServing">Save</button>
          </div>
          <div class="row gap8 wrapc">
            <span class="t-capn c2"><Icon name="lock" :size="10" :sw="2.4" /> Private — only you see your servings.</span>
            <button v-for="row in ownServings" :key="'e' + row.id" type="button" class="linkbtn t-capn" @click="beginEditServing(row)">Edit “{{ row.name }}”</button>
            <button v-for="row in ownServings" :key="'d' + row.id" type="button" class="linkbtn t-capn" :aria-label="`Remove serving ${row.name}`" @click="dropServing(row)">Remove “{{ row.name }}”</button>
          </div>
          <p v-if="servingDraftError && (svName.trim() || svGrams.trim())" class="t-capn errline" role="status">{{ servingDraftError }}</p>
        </div>
        <div class="row gap8 chips">
          <button v-for="amount in quickAmounts" :key="amount" type="button" class="chip t-label" @click="setAmount(amount)">{{ amountLabel(amount, unit) }}</button>
        </div>
      </div>
      <div class="preview" aria-live="polite">
        <div v-for="item in previewItems" :key="item.label" class="col center gap2">
          <span class="t-nm num" data-num>{{ int(item.value) }}</span><span class="t-cap c2">{{ item.label }}</span>
        </div>
      </div>
      <div v-if="after" class="after col">
        <div class="row">
          <span class="t-cap c3">{{ ui.foodDate === foodToday ? "Today" : "That day" }} after {{ editing ? "saving" : "adding" }}</span>
          <span class="grow" />
          <span class="t-capn c3">{{ after[0].v <= after[0].tgt ? `${int(after[0].tgt - after[0].v)} kcal left` : `${int(after[0].v - after[0].tgt)} kcal over` }}</span>
        </div>
        <div v-for="item in after" :key="item.label" class="col arow">
          <div class="row"><span class="t-label c2 grow">{{ item.label }}</span><span class="t-bodys" data-num>{{ int(item.v) }}</span><span class="t-label c3">&nbsp;/ {{ int(item.tgt) }} {{ item.unit }}</span></div>
          <Bar :pct="item.tgt ? item.v / item.tgt : 0" :hit="macroStatus(item.k, item.v, item.tgt) === 'hit'" :over="macroStatus(item.k, item.v, item.tgt) === 'over'" />
        </div>
      </div>
      <div class="grow" />
      <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
      <div v-if="saveError" class="err row" role="alert">
        <Icon name="alert" :size="18" class="c2" />
        <span class="col grow">
          <span class="t-bodys">Server unreachable</span>
          <span class="t-label c2">Nothing was lost — your entry is still here. Try again in a moment.</span>
        </span>
        <button type="button" class="chip" @click="saveError = false">Dismiss</button>
      </div>
      <Keypad v-if="!keyboardEntry" @key="amountKey" />
      <p v-else class="t-capn c3 khint keyhint"><kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> {{ editing ? "close" : "back to search" }}</p>
      <div class="row gap8 actions">
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Copy to another day" :disabled="saving" @click="copyEdited">
          <Icon name="copy" :size="16" /><span>Copy to…</span>
        </button>
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="saving || (!editing && needTime)" @click="addDetail">
          {{ saveError ? "Try again" : addVerb }}<template v-if="!needTime"> · {{ int(preview.kcal) }} kcal</template>
        </button>
      </div>
    </div>

    <template v-else-if="!editing && ui.foodTab === 'search'">
      <label class="field row">
        <Icon name="search" :size="18" class="c2" />
        <input ref="searchEl" v-autofocus v-model="q" class="t-body grow" type="search" :placeholder="filter === 'mine' ? 'Search my foods' : filter === 'recipes' ? 'Search recipes' : 'Search foods'" :aria-label="filter === 'recipes' ? 'Search recipes' : 'Search foods'" autocomplete="off" enterkeyhint="search" @focus="searchFocused = true" @blur="queueSearchBlur" @keydown="searchKey" />
        <button v-if="q" type="button" class="clr c2" aria-label="Clear search" @click="q = ''"><Icon name="x" :size="16" /></button>
      </label>
      <div v-show="!searchFocused" class="row fchips" role="group" aria-label="Show">
        <button type="button" class="chip t-label" :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">All foods</button>
        <button type="button" class="chip t-label" :class="{ on: filter === 'mine' }" :aria-pressed="filter === 'mine'" @click="filter = 'mine'">My foods · {{ mine.length }}</button>
        <button type="button" class="chip t-label" :class="{ on: filter === 'recipes' }" :aria-pressed="filter === 'recipes'" @click="filter = 'recipes'">Recipes · {{ savedRecipes.list.length }}</button>
      </div>
      <div class="list" :class="{ compact: searchFocused }" @wheel.passive="blurSearch" @touchmove.passive="blurSearch">
        <RecipeList
          v-if="filter === 'recipes'"
          :recipes="visibleRecipes"
          heading="Recipes"
          :active-index="keyboardEntry ? hi : -1"
          :saving="saving"
          @add="(recipe) => openRecipeLog(recipe.id)"
          @edit="(recipe) => openRecipeEdit(recipe.id)"
          @remove="removeRecipe"
          @create="openRecipeCreate('food')"
        />
        <template v-if="filter !== 'mine' && filter !== 'recipes' && !searchFocused">
        <SavedGroups
          :groups="visibleGroups"
          :note="groupNote"
          :saving="saving"
          :need-time="needTime"
          :added-id="justGroup"
          @add="addGroup"
          @remove="removeGroup"
        />
        <RecipeList
          :recipes="visibleRecipes"
          :saving="saving"
          @add="(recipe) => openRecipeLog(recipe.id)"
          @edit="(recipe) => openRecipeEdit(recipe.id)"
          @remove="removeRecipe"
          @create="openRecipeCreate('food')"
        />
        </template>
        <template v-if="filter === 'recipes'" />
        <template v-else-if="filter === 'mine'">
          <div v-if="mine.length" class="row lhead">
            <span class="t-cap c2">My foods</span>
            <span class="grow" />
            <button type="button" class="chip t-label" @click="openNewFood(trimmedQuery || undefined)"><Icon name="plus" :size="14" :sw="2.4" /> New food</button>
          </div>
          <div v-if="!mine.length" class="col emptyc">
            <span class="t-bodys">{{ myFoodsEmptyTitle }}</span>
            <span class="t-label c2">{{ myFoodsEmptyDetail }}</span>
            <button type="button" class="chip on t-label" @click="openNewFood()"><Icon name="plus" :size="14" :sw="2.4" /> Create a food</button>
          </div>
          <div v-for="(food, index) in mineListed" :key="food.id" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @mouseenter="hi = index">
            <button type="button" class="col grow rtext" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)">
              <span class="t-body ell">{{ food.name }}</span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </button>
            <button type="button" class="cbtn"  :aria-label="`Edit ${food.name}`" @click="editMine(food, 'list')"><Icon name="edit" :size="17" /></button>
            <button type="button" class="cbtn filled"  :aria-label="needTime ? `Pick a time to add ${food.name}` : `Add ${amountLabel(Number(listedPreset(food).amount), listedPreset(food).unit)} ${food.name}`" :disabled="saving || needTime" @click="addListed(food)">
              <Icon :name="justAdded === food.id ? 'check' : 'plus'" :size="18" :sw="2.4" />
            </button>
          </div>
          <p v-if="mine.length && !mineListed.length" class="t-label c2 empty">No match in my foods.</p>
        </template>
        <template v-else-if="!trimmedQuery">
          <div class="row lhead">
            <span class="t-cap c2">Recent</span>
            <span class="grow" />
            <span class="t-capn c2">{{ keyboardEntry ? recentHintKeys : recentHintTouch }}</span>
          </div>
          <div v-for="(food, index) in recents" :key="food.id" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @mouseenter="hi = index">
            <button type="button" class="col grow rtext" @pointerdown="pressFood($event, food, { amount: food.amount, unit: food.unit })" @click="pickFood($event, food, { amount: food.amount, unit: food.unit })">
              <span class="row gap6 nm"><span class="t-body ell">{{ food.name }}</span><span v-if="isMyFood(food)" class="mine t-capn">my food</span></span>
              <span class="t-label c2 ell">{{ withBrand(food.brand, recentSubtitle(food, food.amount, food.unit)) }}</span>
            </button>
            <button type="button" class="cbtn filled"  :aria-label="needTime ? `Pick a time to add ${food.name}` : `Add ${amountLabel(food.amount, food.unit)} ${food.name}`" :disabled="saving || needTime" @click="addRecent(food)">
              <Icon :name="justAdded === food.id ? 'check' : 'plus'" :size="18" :sw="2.4" />
            </button>
          </div>
          <div v-if="!recents.length" class="col emptyc">
            <span class="t-bodys">{{ recentEmptyTitle }}</span>
            <span class="t-label c2">{{ recentEmptyDetail }}</span>
          </div>
        </template>
        <template v-else>
          <p v-if="searching" class="t-label c2" role="status">Searching…</p>
          <div v-if="searchError" class="err col" role="alert">
            <span class="t-label">{{ searchError }}</span>
            <button v-if="trimmedQuery.length >= 2" type="button" class="chip" @click="runSearch(trimmedQuery)">Try again</button>
          </div>
          <div v-if="results.length" class="row lhead"><span class="t-cap c2">Results</span></div>
          <button v-for="(food, index) in results" :key="food.id" type="button" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)" @mouseenter="hi = index">
            <span class="col grow rtext">
              <span class="row gap6 nm"><span class="t-body ell">{{ food.name }}</span><span v-if="isMyFood(food)" class="mine t-capn">my food</span></span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </span>
          </button>
          <div v-if="off.results.length" class="row lhead"><span class="t-cap c2">Open Food Facts</span></div>
          <button v-for="food in off.results" :key="food.id" type="button" class="rrow row" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)">
            <span class="col grow rtext">
              <span class="t-body ell">{{ food.name }}</span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </span>
          </button>
          <p v-if="off.status === 'loading'" class="t-capn c2 skl" role="status">Searching Open Food Facts…</p>
          <div v-else-if="offCopy" class="err col" role="alert">
            <div class="row gap8"><Icon name="alert" :size="18" class="c2" /><span class="t-bodys">{{ offCopy.title }}</span></div>
            <span class="t-label c2">{{ offCopy.detail }}</span>
            <div class="row offacts">
              <button type="button" class="chip on" @click="askOff"><Icon name="refresh" :size="14" />&nbsp;{{ offCopy.retry }}</button>
              <button type="button" class="chip" @click="useQuickAdd">{{ offCopy.quickAdd }}</button>
            </div>
          </div>
          <p v-if="off.status === 'ok' && off.missingKcal > 0" class="t-label c2 miss">
            {{ missingKcalLead }}
            <button type="button" class="linkbtn" @click="openMissingEditor">{{ missingKcalAction }}</button>
          </p>
          <div v-if="showNoMatch" class="col emptyc">
            <span class="t-label c2">No match for “{{ trimmedQuery }}”.</span>
            <div class="row gap8 wrapc">
              <button type="button" class="chip t-label" @click="openNewFood(trimmedQuery)"><Icon name="plus" :size="14" :sw="2.4" /> Create “{{ trimmedQuery }}”</button>
              <button type="button" class="chip t-label" @click="useQuickAdd">Quick Add</button>
            </div>
          </div>
          <button v-if="showOffButton" type="button" class="chip t-label offask" @click="askOff">Search Open Food Facts</button>
        </template>
        <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
      </div>
      <div v-if="session.length" class="session" role="status">
        <span class="col stext">
          <span class="t-bodys">{{ session.length }} added · {{ int(sessionKcal) }} kcal</span>
          <span class="t-capn c2">{{ pastDay ? dayMonth(ui.foodDate) : "Today" }} · {{ int(foodTotals.kcal) }} kcal</span>
        </span>
        <span class="row sbtns">
          <button v-if="canSaveGroup(session.length)" type="button" class="chip" @click="saveSessionGroup">
            <Icon name="layers" :size="14" /> Save as group
          </button>
          <button v-if="canSaveRecipe(sessionRecipeCount)" type="button" class="chip" @click="saveSessionRecipe">
            <Icon name="food" :size="14" /> Save as recipe
          </button>
          <button type="button" class="chip on" @click="closeSheet">Done</button>
        </span>
      </div>
    </template>

    <div v-else class="body">
      <label class="field row">
        <input v-autofocus v-model="qName" class="t-body grow" type="text" placeholder="Protein bar" aria-label="Name (optional)" autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="keyboardEntry && addQuick()" />
        <span class="t-capn" :class="qSaveNeedsName ? '' : 'c2'">{{ qSave ? "name · needed" : "name · optional" }}</span>
      </label>
      <div class="qgrid">
        <template v-if="keyboardEntry">
          <label v-for="field in fields" :key="'k' + field.key" class="qf" :class="{ on: active === field.key }">
            <span class="t-capm c2">{{ field.label }}</span>
            <span class="base">
              <input :value="qa[field.key]" class="t-nm num qinput" inputmode="decimal" autocomplete="off" :aria-label="field.label"
                :placeholder="field.key === 'kcal' && qKcalAuto ? String(qKcalAuto) : '0'"
                @beforeinput="markWholeSelection" @input="qInput(field.key, $event)" @focus="onQuickFocus(field.key)" @blur="onQuickBlur(field.key)" @keydown.enter.prevent="addQuick" />
              <span class="t-label c2">{{ field.unit }}</span>
            </span>
          </label>
        </template>
        <template v-else>
          <button v-for="field in fields" :key="field.key" type="button" class="qf" :class="{ on: active === field.key }" :aria-label="field.label" @click="onQuickTap(field.key)">
            <span class="t-capm c2">{{ field.label }}</span>
            <span class="base">
              <span v-if="field.key === 'kcal' && qa.kcal === '' && qKcalAuto" class="t-nm num c3" data-num>{{ qKcalAuto }}</span>
              <span v-else-if="qa[field.key] === ''" class="t-nm num c3">0</span>
              <span v-else class="t-nm num" data-num>{{ qa[field.key] }}</span>
              <span class="t-label c2">{{ field.unit }}</span>
            </span>
          </button>
        </template>
      </div>
      <p class="t-capn c2 note">Leave kcal empty and it is worked out from P · F · C (4 · 9 · 4 kcal/g).</p>
      <label v-if="!editing" class="qsave row">
        <input v-model="qSave" type="checkbox" />
        <span class="col"><span class="t-label">Also save as my food</span><span class="t-capn" :class="qSaveNeedsName ? '' : 'c2'">{{ qSaveNeedsName ? "! Add a name above to save it" : "One tap next time · saved per serving · private" }}</span></span>
      </label>
      <button v-else type="button" class="linkbtn t-label save-link" @click="openSeedEditor">Save as my food…</button>
      <div class="grow" />
      <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
      <div v-if="saveError" class="err row" role="alert">
        <Icon name="alert" :size="18" class="c2" />
        <span class="col grow">
          <span class="t-bodys">Server unreachable</span>
          <span class="t-label c2">Nothing was lost — your entry is still here. Try again in a moment.</span>
        </span>
        <button type="button" class="chip" @click="saveError = false">Dismiss</button>
      </div>
      <Keypad v-if="!keyboardEntry" @key="qKey" />
      <p v-else class="t-capn c3 khint keyhint"><kbd>Tab</kbd> next field · <kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> close</p>
      <div class="row gap8 actions">
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Copy to another day" :disabled="saving" @click="copyEdited">
          <Icon name="copy" :size="16" /><span>Copy to…</span>
        </button>
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="saving || (!editing && needTime) || !qKcal || qSaveNeedsName" @click="addQuick">
          {{ saveError ? "Try again" : addVerb }}<template v-if="!needTime"> · {{ int(qKcal) }} kcal</template>
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-gap); min-width: 0; flex-wrap: wrap; align-items: center; }
.needt { margin: 0; display: flex; align-items: center; gap: 6px; color: var(--text-secondary); }
.toast-pad { display: flex; flex-direction: column; gap: 12px; padding-top: var(--food-toast-space, 0px); }
.gap2 { gap: 2px; }
.gap8 { gap: 8px; }
.center { align-items: center; text-align: center; }
.field { min-height: 44px; padding: 0 12px; gap: 8px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; min-width: 0; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; width: 100%; padding: 0; }
.field input::placeholder { color: var(--text-tertiary); }
.field input::-webkit-search-cancel-button { display: none; }
.list { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.rrow { min-height: 56px; width: 100%; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--color-border); text-align: left; background: transparent; }
.list.compact .rrow { min-height: 40px; padding: 2px 0; gap: 8px; }
.list.compact .rtext { min-height: 0; }
.rrow.hl { background: var(--color-surface-2); border-radius: 12px; }
.rtext { gap: 2px; min-width: 0; align-items: flex-start; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.clr { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.qgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: none; min-width: 0; }
.qf { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; min-height: 72px; border-radius: var(--radius-control); background: var(--color-surface-2); text-align: left; min-width: 0; }
.qf.on, .qf:focus-within { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.qinput, .ginput { width: 8ch; min-width: 0; max-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; }
.qinput::placeholder { color: var(--text-tertiary); }
.note, .khint { margin: 0; }
.khint { text-align: center; }
.err { gap: 12px; padding: 14px; border-radius: var(--radius-card); border: 1px dashed var(--text-tertiary); flex: none; min-width: 0; }
.err.t-label { margin: 0; }
.emptyc { gap: 8px; padding: 12px 0 20px; }
.lhead { padding: 10px 0 2px; }
.rtext { min-height: 44px; justify-content: center; }
.linkbtn { text-decoration: underline; text-underline-offset: 3px; }
.miss { margin: 8px 0; }
.offacts { gap: 8px; flex-wrap: wrap; }
.offask { align-self: flex-start; margin: 8px 0; }
.skl { padding: 12px 0; }
.actions { flex: none; flex-wrap: wrap; }
.actions .primary-btn { width: auto; flex: 1 1 160px; min-width: 0; }
.del-btn { min-height: 52px; min-width: 44px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; }
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dname { margin: 0; overflow-wrap: anywhere; }
.preview { display: flex; justify-content: space-around; gap: 8px; padding: 14px 8px; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.units, .chips { gap: 8px; flex-wrap: wrap; justify-content: center; max-width: 100%; }
.unit-radios { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 100%; }
.uchip {
  position: relative; box-sizing: border-box; min-width: var(--control-hit); min-height: var(--control-hit);
  padding: calc((var(--control-hit) - var(--control-s)) / 2) var(--space-gap);
  border: 0; border-radius: calc(var(--control-s) / 2); background: transparent; color: var(--text-primary);
  display: inline-flex; align-items: center; justify-content: center; gap: calc(var(--space-gap) / 3);
  isolation: isolate;
}
.uchip::before {
  content: ""; position: absolute; z-index: -1; left: 0; right: 0;
  top: calc((var(--control-hit) - var(--control-s)) / 2);
  bottom: calc((var(--control-hit) - var(--control-s)) / 2);
  border-radius: calc(var(--control-s) / 2); border: 1px solid var(--color-border);
}
.uchip > * { position: relative; }
.uchip.on { color: var(--color-on-action); }
.uchip.on::before { background: var(--color-action); border-color: var(--color-action); }
.uchip.add { color: var(--text-secondary); gap: calc(var(--space-gap) / 2); }
.uchip.add::before { border-style: dashed; }
.ug { color: var(--text-secondary); }
.svform { gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); align-items: center; width: 100%; }
.sinp { height: 44px; width: 110px; min-width: 0; padding: 0 10px; border-radius: 10px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--text-primary); }
.sinp.num { width: 72px; }
.sinp:focus { outline: none; border-color: var(--color-action); }
.errline { margin: 0; color: var(--text-secondary); min-height: 1.2em; }
.linkbtn { min-height: 44px; padding: 8px 2px; }
.uchip.on .ug { color: var(--color-on-action); }
.after { gap: 12px; padding: 16px; border-radius: var(--radius-card); border: 1px solid var(--color-border); }
.arow { gap: 6px; }
.session { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.stext { flex: 1 1 150px; min-width: 0; }
.sbtns { gap: 8px; flex: 0 0 auto; margin-left: auto; }
.dt-l .units, .dt-l .chips { justify-content: center; }
.dt-l .uchip { min-height: 44px; }
.dt-xl .preview { display: grid; grid-template-columns: 1fr 1fr; row-gap: 12px; }
.dt-xl .qgrid { grid-template-columns: 1fr; }
.fchips { gap: var(--space-gap); flex-wrap: wrap; flex: none; }
.mine { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--color-border); color: var(--text-secondary); white-space: nowrap; flex: none; }
.nm { min-width: 0; max-width: 100%; }
.gap6 { gap: 6px; }
.wrapc { flex-wrap: wrap; justify-content: center; }
.qsave { gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); cursor: pointer; flex: none; }
.qsave input { width: 22px; height: 22px; margin-top: 2px; accent-color: var(--color-action); flex: none; }
.save-link { align-self: flex-start; padding: 8px 0; }
.empty { margin: 0; padding: 8px 0; }
</style>
