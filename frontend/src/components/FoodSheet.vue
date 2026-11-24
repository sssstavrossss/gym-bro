<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiError, createCustomFood, getFood, restoreCustomFood, listMyFoods, listRecentFoods, searchFoods, searchOpenFoodFacts, ServerUnreachable, type FoodSearchRow, type OffFoodRow, type RecentFood, type SavedGroup } from "../api";
import BottomSheet from "./BottomSheet.vue";
import FoodEditor from "./FoodEditor.vue";
import Icon from "./Icon.vue";
import MicroRing from "./MicroRing.vue";
import Keypad from "./Keypad.vue";
import Segmented from "./Segmented.vue";
import TimeChip from "./TimeChip.vue";
import FoodAmountView from "./FoodAmountView.vue";
import BarcodeScanner from "./BarcodeScanner.vue";
import OfflineNote from "./OfflineNote.vue";
import DescribePane from "./DescribePane.vue";
import CappedList from "./CappedList.vue";
import LogRow from "./LogRow.vue";
import { sessionLines, sessionRows } from "../lib/addSession";
import { activateMark, activateRow, type Selection } from "../lib/selection";
import { dayMonth, todayInZone } from "../lib/dates";
import { focusField, primeKeyboard } from "../lib/focusField";
import { int } from "../lib/format";
import { useFoodAmount } from "../lib/useFoodAmount";
import {
  defaultAmount,
  macrosForFood,
  normalizeUnit,
  per100Line,
  servingName,
  type OwnServing,
} from "../lib/foodAmount";
import { amountErrorIn } from "../lib/foodUnits";
import { countryTag, foodTitle, originLine } from "../lib/foodOrigin";
import { acceptSearchResult, preparedSearch, searchDebounceMs, searchKept, spellingNote } from "../lib/foodSearch";
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
import { kcalFromMacros, type MacroAmounts } from "../lib/macros";
import { bindPick, clickPick } from "../lib/cleanTap";
import { afterInsertion, markWholeSelection, nextQuickInput, nextQuickNumber, tookWholeSelection } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";
import { connection } from "../state/connection";
import { deviceTimeZone, foodCountry } from "../state/profile";
import { afterTitle, entriesOn, targetOn } from "../state/foodDay";
import { findEntry, removeEntries, removeEntry, saveQuickAdd, totalsOf, updateFoodAmount, updateQuickAdd, viewed, type LogEntry } from "../state/log";
import SavedGroups from "./SavedGroups.vue";
import RecipeList from "./RecipeList.vue";
import { canSaveGroup, groupTimeNote, matchingGroups, readdToast } from "../lib/groups";
import { canSaveRecipe, matchingRecipes, recipeFoodEntries } from "../lib/recipes";
import { deleteSavedGroup, loadGroups, readdSavedGroup, restoreSavedGroup, savedGroups } from "../state/groups";
import { loadRecipes, savedRecipes } from "../state/recipes";
import { foodAmount, foodUnit } from "../state/units";
import { addChosen, describe, loadDescribe, resetDescribe, setRowAmount } from "../state/describe";
import { closeFoodLayer, closeSheet, editAdded, endAddedPick, leaveAddedEdit, openCopy, openFoodScan, openGroupSheet, openRecipeCreate, openRecipeEdit, openRecipeFromEntries, openRecipeLog, toast, toastError, ui, type FoodTab } from "../ui";

const open = computed(() => ui.sheet === "food");
const editing = computed(() => findEntry(ui.editEntryId));
const foodToday = computed(() => viewed.today || todayInZone(deviceTimeZone()));
/** Any day but today, earlier or planned, needs a picked time, never now. */
const otherDay = computed(() => ui.foodDate !== foodToday.value);
const needTime = computed(() => addNeedsTime(ui.foodDate, foodToday.value, time.value, Boolean(editing.value)));
/** A quick add, or an entry the server refused: both edit as plain numbers, and Save sends a quick add. */
function editsAsQuick(entry: LogEntry): boolean {
  return entry.source === "quick" || entry.queued === "failed";
}
const editingFood = computed(() => (editing.value && !editsAsQuick(editing.value) ? editing.value : null));
const showEditor = computed(() => ui.foodEditor != null);
const showScan = computed(() => ui.foodScan && !showEditor.value && !ui.detailFoodId);
const showDetail = computed(() => Boolean(ui.detailFoodId || editingFood.value));
const sheetLabel = computed(() => {
  if (ui.foodEditor) return ui.foodEditor.id ? "Edit my food" : "New food";
  if (showScan.value) return "Scan barcode";
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
/** The spelling the server added foods for ("kjøttdeig" for "kjottdeig"); set with the results it came with. */
const corrected = ref<string | null>(null);
const spelling = computed(() => spellingNote(corrected.value));
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
const listEl = ref<HTMLElement | null>(null);
const searchFocused = ref(false);
/** Search chrome, kept after a result is added so the query and list come back. Not the same as the field having focus. */
const searchView = ref(false);
const searchScroll = ref(0);
let keepSearch = false;
const resultsMax = ref("");
const amountView = ref<InstanceType<typeof FoodAmountView> | null>(null);
const foodChanged = ref(false);
/** Offline the food itself can't be fetched, so whether it changed is unknown: say nothing. */
const foodUnseen = ref(false);
/** Entries added since the sheet opened, as they were added. The card shows each one's current copy (`added`). */
const session = ref<LogEntry[]>([]);
/** Rows the card shows before it scrolls. With large text one, so the search keeps some room (read when the sheet opens). */
const addedCap = ref(2);
const justGroup = ref<string | null>(null);
const groupKeys = new Map<string, string>();
let searchGen = 0;
let searchTimer = 0;

const dayLoaded = computed(() => viewed.date === ui.foodDate || ui.foodDate === foodToday.value);
const added = computed(() => sessionRows(session.value, dayLoaded.value ? foodEntries.value : null));
const addedIds = computed(() => added.value.map((entry) => entry.id));
const picking = computed(() => ui.addedPick.selecting);
const picked = computed(() => added.value.filter((entry) => ui.addedPick.selected.includes(entry.id)));
const addedLines = computed(() => sessionLines(
  added.value,
  picking.value ? ui.addedPick.selected : null,
  otherDay.value ? dayMonth(ui.foodDate) : "Today",
  foodTotals.value.kcal,
));
const visibleGroups = computed(() => matchingGroups(savedGroups.list, q.value));
const visibleRecipes = computed(() => matchingRecipes(savedRecipes.list, q.value));
const sessionRecipeCount = computed(() => recipeFoodEntries(added.value).length);
const groupNote = computed(() => groupTimeNote(needTime.value, otherDay.value, time.value));
const foodEntries = computed(() => entriesOn(ui.foodDate, foodToday.value));
const foodTotals = computed(() => totalsOf(foodEntries.value));
const tabs = computed(() => {
  const list: { value: FoodTab; label: string }[] = [{ value: "search", label: "Search" }];
  if (describe.available || ui.foodTab === "describe") list.push({ value: "describe", label: "Describe" });
  list.push({ value: "quick", label: "Quick Add" });
  return list;
});
/** A row from Describe is open on the amount screen: its button says Use and goes back to the list. */
const describing = computed(() => describe.editing != null && Boolean(ui.detailFoodId) && !editing.value);
const addVerb = computed(() => {
  if (editing.value) return "Save";
  if (needTime.value) return "Pick a time to add";
  if (otherDay.value && time.value) return `Add to ${dayMonth(ui.foodDate)} at ${time.value}`;
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
  if (entry && editsAsQuick(entry)) {
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

/** The amount screen. A serving saved there also updates this sheet's lists. */
// The first quick amount is what this person logged last time, from the recents list.
const amount = useFoodAmount({
  entry: () => editingFood.value,
  formError,
  saveError,
  onServings: applyServings,
  lastLogged: (foodId) => recents.value.find((row) => row.id === foodId) ?? null,
});
const { food: detailFood, unit, amountNumber, preview } = amount;
/** The preview is the Home card for the day the food goes to, with this food in it. */
const sheetGoal = computed(() => targetOn(ui.foodDate, foodToday.value));
/** The day's totals before this food: an edited entry's old amounts come out first. */
const dayBefore = computed<MacroAmounts>(() => {
  const totals = foodTotals.value;
  const old = editing.value ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  return { kcal: totals.kcal - old.kcal, p: totals.p - old.protein, f: totals.f - old.fat, c: totals.c - old.carbs };
});
const macroTitle = computed(() => afterTitle(ui.foodDate, foodToday.value, editing.value ? "saving" : "adding", Boolean(sheetGoal.value)));

function rowSub(food: FoodSearchRow): string {
  return withBrand(food.brand, originLine(food, foodCountry()) + per100Line(food));
}
const detailIsMine = computed(() => (detailFood.value ? isMyFood(detailFood.value) : false));

function showFood(food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  ui.detailFoodId = food.id;
  amount.show(food, preset);
  foodChanged.value = false;
  formError.value = "";
  saveError.value = false;
  idempotencyKey.value = "";
}
function holdSearchPlace() {
  if (!searchFocused.value && !searchView.value) return;
  keepSearch = true;
  searchView.value = true;
  if (listEl.value) searchScroll.value = listEl.value.scrollTop;
}
function pickFood(event: MouseEvent, food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  clickPick(event, () => { holdSearchPlace(); void openFoodRow(food, preset); });
}
function pressFood(event: PointerEvent, food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  holdSearchPlace();
  bindPick(event, () => { void openFoodRow(food, preset); });
}
function closeSearchKeyboard() {
  searchEl.value?.blur();
  if (!keyboardEntry.value) document.querySelector<HTMLElement>(".kb-proxy")?.blur();
}
function restoreSearchList() {
  searchFocused.value = false;
  const top = searchScroll.value;
  void nextTick(() => {
    searchEl.value?.blur();
    const list = listEl.value;
    if (!list) return;
    list.scrollTop = top;
    requestAnimationFrame(() => { if (listEl.value) listEl.value.scrollTop = top; });
  });
}
async function openFoodRow(food: FoodSearchRow, preset?: { amount: number; unit: string }) {
  holdSearchPlace();
  if (keyboardEntry.value) primeKeyboard();
  else closeSearchKeyboard();
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
    doneEditing();
    return;
  }
  if (showScan.value) {
    ui.foodScan = false;
    return;
  }
  if (describing.value) {
    leaveDescribed();
    return;
  }
  ui.detailFoodId = null;
  detailFood.value = null;
  formError.value = "";
  searchView.value = false;
  keepSearch = false;
}
function openNewFood(seedName?: string) {
  primeKeyboard();
  ui.foodEditor = { seed: seedName ? { name: seedName } : undefined, ret: "list" };
}
function startScan() {
  closeSearchKeyboard();
  openFoodScan();
}
function onScanFound(food: FoodSearchRow) {
  ui.foodScan = false;
  void openFoodRow(food);
}
function onScanCreate(code: string) {
  ui.foodScan = false;
  primeKeyboard();
  ui.foodEditor = { seed: { barcode: code }, ret: "list" };
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
function onSearchFocus() {
  searchView.value = true;
  searchFocused.value = true;
}
function queueSearchBlur() {
  window.setTimeout(() => {
    searchFocused.value = false;
    if (!keepSearch) searchView.value = false;
  }, 0);
}
function fitResults() {
  const list = listEl.value;
  const viewport = window.visualViewport;
  if (!list || !searchFocused.value || !viewport) {
    resultsMax.value = "";
    return;
  }
  const top = list.getBoundingClientRect().top;
  const visibleBottom = viewport.offsetTop + viewport.height;
  resultsMax.value = `${Math.max(120, Math.floor(visibleBottom - top))}px`;
}
function outsideSearch(event: PointerEvent) {
  if (!searchFocused.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (searchEl.value?.closest("label")?.contains(target)) return;
  if (listEl.value?.contains(target)) return;
  closeSearchKeyboard();
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
const showOffButton = computed(() => !connection.offline && canAskOpenFoodFacts(q.value) && off.value.status === "idle" && !searchError.value);
const searchPlaceholder = computed(() => {
  if (filter.value === "mine") return "Search my foods";
  if (filter.value === "recipes") return "Search recipes";
  return connection.offline ? "Search your foods" : "Search foods";
});
/** Offline, search looks through the foods kept on this phone: recents and My foods. */
function keptResults(trimmed: string): FoodSearchRow[] {
  return searchKept(trimmed, [recents.value, mine.value]);
}

function isRecent(food: FoodSearchRow): food is RecentFood {
  return typeof (food as RecentFood).amount === "number" && typeof (food as RecentFood).unit === "string" && !trimmedQuery.value;
}
function searchKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !keyboardEntry.value) {
    event.preventDefault();
    closeSearchKeyboard();
    return;
  }
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
      if (recipe) pickRecipe(recipe.id);
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
  closeSearchKeyboard();
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
  toast(`Deleted ${food.name} · past entries kept`, { label: "Undo", run: () => { void undoFoodDelete(food); } });
}
async function undoFoodDelete(food: FoodSearchRow) {
  try {
    await restoreCustomFood(food.id);
  } catch {
    toastError("Couldn't restore that food.");
    return;
  }
  await loadMine();
  if (trimmedQuery.value && filter.value === "all") void runSearch(trimmedQuery.value);
}
/** Undo for adds: the entries go, and so do their rows in the "added" bar. */
function undoAdds(entries: LogEntry[]) {
  const keys = new Set(entries.map((entry) => entry.idempotencyKey));
  session.value = session.value.filter((row) => !keys.has(row.idempotencyKey));
  void removeEntries(entries, { announce: false });
}
/** The add toast: Undo, and back-to-back adds fold into one ("Added 2 foods · 237 kcal"). */
function addedToast(text: string, entries: LogEntry[]) {
  const kcal = entries.reduce((sum, entry) => sum + entry.kcal, 0);
  toast(text, { label: "Undo", run: () => undoAdds(entries) }, { merge: { kind: "add", count: entries.length, kcal } });
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
  closeSearchKeyboard();
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
      saveError.value = false;
      formError.value = result.message;
      return;
    }
    recentKeys.delete(food.id);
    noteSession(result.entry);
    addedToast(`Added ${foodAmount(result.entry.amount, result.entry.unit || picked.unit)} ${result.entry.name} · ${int(result.entry.kcal)} kcal`, [result.entry]);
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
  if (connection.offline) {
    results.value = keptResults(trimmed);
    corrected.value = null;
    searching.value = false;
    return;
  }
  try {
    const body = await searchFoods(trimmed);
    if (!acceptSearchResult(gen, trimmed, searchGen, q.value)) return;
    results.value = body.foods;
    corrected.value = body.correctedQuery ?? null;
  } catch (error) {
    if (gen !== searchGen) return;
    corrected.value = null;
    if (error instanceof ServerUnreachable) {
      results.value = keptResults(trimmed);
      return;
    }
    results.value = [];
    searchError.value = error instanceof ApiError ? error.message : "Couldn't search foods.";
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
    corrected.value = null;
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
  amount.showStored(entry.amount, kind);
  foodChanged.value = false;
  foodUnseen.value = false;
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
  } catch (error) {
    if (ui.editEntryId !== entry.id) return;
    // Without the food, work from the values it was logged with.
    foodChanged.value = true;
    foodUnseen.value = error instanceof ServerUnreachable;
  }
}
function pickRecipe(id: string) {
  closeSearchKeyboard();
  openRecipeLog(id);
}
function focusFor() {
  if (ui.sheet !== "food" || ui.foodEditor) return;
  if (!showDetail.value) return;
  void nextTick(() => {
    const field = amountView.value?.field;
    if (field) focusField(field);
  });
}
function onAddTabPointer(event: PointerEvent) {
  const label = (event.target as HTMLElement).closest("button")?.textContent?.trim();
  const next = label === "Quick Add" ? "quick" : label === "Describe" ? "describe" : label === "Search" ? "search" : null;
  if ((next === "quick" || next === "describe") && next !== ui.foodTab) primeKeyboard();
}
watch(searchFocused, (focused) => {
  if (!focused) {
    resultsMax.value = "";
    return;
  }
  void nextTick(fitResults);
});
onMounted(() => {
  window.visualViewport?.addEventListener("resize", fitResults);
  window.visualViewport?.addEventListener("scroll", fitResults);
  window.addEventListener("pointerdown", outsideSearch, true);
});
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener("resize", fitResults);
  window.visualViewport?.removeEventListener("scroll", fitResults);
  window.removeEventListener("pointerdown", outsideSearch, true);
});
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
  resetDescribe();
  void loadDescribe();
  q.value = "";
  results.value = [];
  corrected.value = null;
  searchView.value = false;
  searchFocused.value = false;
  searchScroll.value = 0;
  keepSearch = false;
  searchError.value = "";
  searching.value = false;
  session.value = [];
  addedEdit = null;
  addedCap.value = document.documentElement.classList.contains("dt-l") ? 1 : 2;
  off.value = idleOff();
  filter.value = "all";
  detailFood.value = null;
  amount.resetServingForm();
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

function noteSession(entry: LogEntry) {
  session.value.push(entry);
}

// The "added" card: Home's rows. Tap one to edit it here, swipe or hover for Copy to… and Delete, or select
// some and use the card's own buttons. The log's select bar stays out of it.
function applyPick(next: Selection | "edit", entry: LogEntry) {
  if (next === "edit") {
    editAdded(entry.id);
    return;
  }
  holdButtonsHeight();
  ui.addedPick = next;
}
/** The card's buttons swap in place. Their labels wrap differently, so the row keeps the height it had and the card doesn't move. */
const buttonsEl = ref<HTMLElement | null>(null);
const buttonsHeight = ref(0);
function holdButtonsHeight() {
  if (!picking.value) buttonsHeight.value = buttonsEl.value?.offsetHeight ?? 0;
}
function tapAdded(entry: LogEntry, event: MouseEvent) {
  applyPick(activateRow(ui.addedPick, addedIds.value, entry.id, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey }), entry);
}
function checkAdded(entry: LogEntry, event: MouseEvent) {
  applyPick(activateMark(ui.addedPick, addedIds.value, entry.id, event.shiftKey), entry);
}
function holdAdded(entry: LogEntry) {
  holdButtonsHeight();
  ui.addedPick = { selecting: true, selected: [entry.id], anchor: entry.id };
}
function copyAdded(entries: LogEntry[], single: boolean) {
  if (!entries.length) return;
  ui.selected = entries.map((entry) => entry.id);
  ui.anchor = entries[0].id;
  openCopy(single, "food");
}
async function deleteAdded(entries: LogEntry[]) {
  if (!entries.length) return;
  if (await removeEntries(entries)) endAddedPick();
}

// Edit food opened from the card keeps the search behind it: the time picked for adds, and the list's place.
let addedEdit: { time: string | null } | null = null;
watch(() => ui.editEntryId, (id) => {
  if (id && ui.editFromAdded && !addedEdit) {
    const entry = findEntry(id);
    if (!entry) return;
    addedEdit = { time: time.value };
    if (listEl.value) searchScroll.value = listEl.value.scrollTop;
    closeSearchKeyboard();
    detailFood.value = null;
    amount.resetServingForm();
    fill(entry);
    if (editingFood.value) {
      ui.detailFoodId = editingFood.value.foodId;
      void prepareEdit(editingFood.value);
    }
    return;
  }
  if (!id && addedEdit) {
    const kept = addedEdit;
    addedEdit = null;
    detailFood.value = null;
    fill(null);
    time.value = kept.time;
    restoreSearchList();
  }
});
/** Save, Delete and Back on an edit: back to the search when it came from the card, else the sheet closes. */
function doneEditing() {
  if (ui.editFromAdded) leaveAddedEdit();
  else closeSheet();
}

// Describe: the pane lists what Claude found. Changing a row uses the usual amount screen.
function openDescribed(index: number) {
  const row = describe.rows[index];
  if (!row?.food) return;
  describe.editing = index;
  showFood(row.food, { amount: row.amount, unit: row.unit });
}
function leaveDescribed() {
  describe.editing = null;
  ui.detailFoodId = null;
  detailFood.value = null;
  formError.value = "";
}
function useDescribed() {
  const index = describe.editing;
  if (index == null) return;
  const limit = amountErrorIn(amountNumber.value, unit.value, foodUnit());
  if (limit) {
    formError.value = limit;
    return;
  }
  setRowAmount(index, amountNumber.value, unit.value);
  leaveDescribed();
}
function submitDetail() {
  if (describing.value) useDescribed();
  else void addDetail();
}
/** No match: Search with Claude's name for it. The list waits on the Describe tab. */
function searchDescribed(query: string) {
  filter.value = "all";
  ui.foodTab = "search";
  q.value = query;
}
function quickDescribed(name: string) {
  primeKeyboard();
  fill(null);
  qName.value = name.slice(0, 80);
  ui.foodTab = "quick";
}
async function addDescribed() {
  const when = logTimeForAdd(ui.foodDate, foodToday.value, time.value);
  if (!when.ok) {
    describe.error = "Pick a time to add";
    return;
  }
  describe.error = "";
  const result = await addChosen({ localDate: ui.foodDate, timeZone: deviceTimeZone(), time: when.time });
  for (const entry of result.added) noteSession(entry);
  if (!result.ok) {
    if (result.message) describe.error = result.message;
    return;
  }
  const count = result.added.length;
  addedToast(`Added ${count === 1 ? "1 food" : `${count} foods`} · ${int(result.kcal)} kcal`, result.added);
  void loadRecents();
  ui.foodTab = "search";
}
function saveSessionGroup() {
  if (!canSaveGroup(added.value.length)) return;
  openGroupSheet(addedIds.value, "food");
}
function saveSessionRecipe() {
  if (!canSaveRecipe(sessionRecipeCount.value)) return;
  openRecipeFromEntries(addedIds.value, "food");
}
async function addGroup(group: SavedGroup) {
  closeSearchKeyboard();
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
  const text = readdToast(group.name, result.entries.length, addedKcal, result.notice);
  // A notice (a food that is gone) stays its own toast so it isn't folded away.
  if (result.entries.length && !result.notice.trim()) addedToast(text, result.entries);
  else toast(text, result.entries.length ? { label: "Undo", run: () => undoAdds(result.entries) } : undefined);
}
async function removeGroup(group: SavedGroup) {
  if (saving.value) return;
  saving.value = true;
  const index = savedGroups.list.findIndex((row) => row.id === group.id);
  formError.value = "";
  const removed = await deleteSavedGroup(group.id);
  saving.value = false;
  if (!removed.ok) {
    formError.value = removed.message;
    return;
  }
  toast(`Deleted group ${group.name}`, {
    label: "Undo",
    run: () => {
      void restoreSavedGroup(group.id, index).then((ok) => {
        if (!ok) toastError("Couldn't restore that group.");
      });
    },
  });
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
        saveError.value = false;
        formError.value = result.message;
        return;
      }
      toast(`Updated ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
      doneEditing();
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
      saveError.value = false;
      formError.value = result.message;
      return;
    }
    const savedMine = qSave.value;
    noteSession(result.entry);
    addedToast(savedMine
      ? `Added ${result.entry.name} · ${int(result.entry.kcal)} kcal · saved to My foods`
      : `Added ${result.entry.name} · ${int(result.entry.kcal)} kcal`, [result.entry]);
    if (savedMine) void loadMine();
    const held = otherDay.value ? time.value : null;
    fill(null);
    if (held) time.value = held;
    saveError.value = false;
    ui.foodTab = "search";
  } finally {
    saving.value = false;
  }
}

function applyServings(foodId: string, servings: OwnServing[]) {
  const next = <T extends { id: string }>(food: T): T => food.id === foodId ? { ...food, servings } : food;
  recents.value = recents.value.map(next);
  results.value = results.value.map(next);
  mine.value = mine.value.map(next);
  if (off.value.results.some((row) => row.id === foodId)) {
    off.value = { ...off.value, results: off.value.results.map((row) => row.id === foodId ? { ...row, servings } : row) };
  }
}
async function addDetail() {
  if (saving.value) return;
  if (!editingFood.value && needTime.value) {
    formError.value = "Pick a time to add";
    saveError.value = false;
    return;
  }
  const limit = amountErrorIn(amountNumber.value, unit.value, foodUnit());
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
      }, previewNow);
      if (!result.ok) {
        saveError.value = false;
        formError.value = result.message;
        return;
      }
      toast(`Updated ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
      doneEditing();
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
      saveError.value = false;
      formError.value = result.message;
      return;
    }
    noteSession(result.entry);
    addedToast(`Added ${foodAmount(result.entry.amount, result.entry.unit || unit.value)} ${result.entry.name} · ${int(result.entry.kcal)} kcal`, [result.entry]);
    const backToSearch = searchView.value;
    ui.detailFoodId = null;
    detailFood.value = null;
    if (!backToSearch) q.value = "";
    if (backToSearch) restoreSearchList();
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
  if (ui.editFromAdded) {
    leaveAddedEdit();
    copyAdded([entry], true);
    return;
  }
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
  if (removed) doneEditing();
}
</script>

<template>
  <BottomSheet :open="open" :label="sheetLabel" full @close="closeSheet">
    <template #header>
      <div class="headcol">
      <div class="row hdr">
        <button v-if="showDetail || showEditor || showScan || ui.editFromAdded" type="button" class="cbtn"  aria-label="Back" @click="back">
          <Icon name="left" :size="18" />
        </button>
        <h2 v-if="showScan" class="t-head">Scan barcode</h2>
        <h2 v-else-if="!showDetail && !showEditor && (!searchView || editing)" class="t-head">{{ editing ? "Edit food" : "Add food" }}</h2>
        <span class="grow" />
        <TimeChip v-if="!showEditor && !showScan && (showDetail || !searchView || editing)" v-model="time" :date="ui.foodDate" :today="foodToday" :allow-now="!otherDay && !editing" />
        <button type="button" class="cbtn"  aria-label="Close" @click="closeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
      <p v-if="needTime && !showEditor && !showScan" class="needt t-label" role="status">
        <Icon name="clock" :size="14" :sw="2.2" /> Logging to {{ dayMonth(ui.foodDate) }} — pick the time you ate it.
      </p>
      <Segmented v-if="!showDetail && !editing && !showEditor && !showScan && !searchView" v-model="ui.foodTab" label="Add food" :options="tabs" @pointerdown="onAddTabPointer" />
      </div>
    </template>

    <div v-if="showEditor && ui.foodEditor" class="list">
      <FoodEditor :key="ui.foodEditor.id ?? 'new'" :edit-id="ui.foodEditor.id" :seed="ui.foodEditor.seed" :namesakes="mine" @saved="onFoodSaved" @deleted="onFoodDeleted" @cancel="back" />
    </div>

    <div v-else-if="showScan" class="list">
      <BarcodeScanner @found="onScanFound" @create="onScanCreate" />
    </div>

    <FoodAmountView v-else-if="showDetail" ref="amountView" :amount="amount" :macro-title="macroTitle" :goal="sheetGoal" :before="dayBefore" @submit="submitDetail">
      <template #meta>
        <span v-if="detailIsMine" class="tag t-capn"><Icon name="lock" :size="10" :sw="2.4" /> my food</span>
        <span v-if="detailFood?.brand">{{ detailFood.brand }} ·</span>
      </template>
      <template #meta-end>
        <button v-if="detailIsMine && !editing" type="button" class="btn sm secondary t-label" @click="detailFood && editMine(detailFood, 'detail')"><Icon name="edit" :size="14" /> Edit</button>
      </template>
      <template #notice>
        <span v-if="editingFood && foodChanged && !foodUnseen" class="t-capn c2">Using the values it was logged with — this food has changed since.</span>
      </template>
      <template #alerts>
        <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
        <div v-if="saveError" class="err row" role="alert">
          <Icon name="alert" :size="18" class="c2" />
          <span class="col grow">
            <span class="t-bodys">Needs a connection</span>
            <span class="t-label c2">Saving to your foods needs a connection. Nothing was lost. Try again once you\'re back online.</span>
          </span>
          <button type="button" class="btn sm secondary t-label" @click="saveError = false">Dismiss</button>
        </div>
      </template>
      <template #note><OfflineNote :entry="editing" /></template>
      <template #hint>
        <template v-if="describing"><kbd>Enter</kbd> use · <kbd>Esc</kbd> back to the list</template>
        <template v-else><kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> {{ editing ? "close" : "back to search" }}</template>
      </template>
      <template #actions>
        <button v-if="editing && editing.queued !== 'failed'" type="button" class="btn secondary t-bodys" aria-label="Copy to another day" :disabled="saving" @click="copyEdited">
          <Icon name="copy" :size="16" /><span>Copy</span>
        </button>
        <button v-if="editing" type="button" class="btn secondary t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button v-if="describing" type="button" class="btn primary block t-bodys grow" @click="useDescribed">
          Use · {{ int(preview.kcal) }} kcal
        </button>
        <button v-else type="button" class="btn primary block t-bodys grow" :disabled="saving || (!editing && needTime)" @click="addDetail">
          {{ saveError ? "Try again" : addVerb }}<template v-if="!needTime"> · {{ int(preview.kcal) }} kcal</template>
        </button>
      </template>
    </FoodAmountView>

    <DescribePane v-else-if="!editing && ui.foodTab === 'describe'" :today="foodToday" :need-time="needTime" @open="openDescribed" @search="searchDescribed" @quick="quickDescribed" @add="addDescribed" />

    <template v-else-if="!editing && ui.foodTab === 'search'">
      <label class="field row">
        <Icon name="search" :size="18" class="c2" />
        <input ref="searchEl" v-model="q" data-no-autofocus class="t-body grow" type="search" :placeholder="searchPlaceholder" :aria-label="filter === 'recipes' ? 'Search recipes' : 'Search foods'" autocomplete="off" enterkeyhint="search" @focus="onSearchFocus" @blur="queueSearchBlur" @keydown="searchKey" />
        <button v-if="q" type="button" class="clr c2" aria-label="Clear search" @click="q = ''"><Icon name="x" :size="16" /></button>
        <button v-else-if="filter !== 'recipes'" type="button" class="clr scanb" aria-label="Scan a barcode" @click="startScan"><Icon name="scan" :size="20" /></button>
      </label>
      <div v-show="!searchView" class="row fchips" role="group" aria-label="Show">
        <button type="button" class="chip t-label" :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">All foods</button>
        <button type="button" class="chip t-label" :class="{ on: filter === 'mine' }" :aria-pressed="filter === 'mine'" @click="filter = 'mine'">My foods · {{ mine.length }}</button>
        <button type="button" class="chip t-label" :class="{ on: filter === 'recipes' }" :aria-pressed="filter === 'recipes'" @click="filter = 'recipes'">Recipes · {{ savedRecipes.list.length }}</button>
      </div>
      <p v-if="connection.offline" v-show="!searchView" class="well t-label c2 offwell" role="status" data-offline-search>
        <Icon name="cloud-off" :size="16" class="oic" />
        <span><strong class="offk">Offline.</strong> Your recent foods, My foods and Quick add work. Searching the full food list needs a connection.</span>
      </p>
      <div ref="listEl" class="list" :class="{ compact: searchFocused }" :style="resultsMax ? { maxHeight: resultsMax } : undefined">
        <RecipeList
          v-if="filter === 'recipes'"
          :recipes="visibleRecipes"
          heading="Recipes"
          :active-index="keyboardEntry ? hi : -1"
          :saving="saving"
          @add="(recipe) => pickRecipe(recipe.id)"
          @edit="(recipe) => openRecipeEdit(recipe.id)"
          @create="openRecipeCreate('food')"
        />
        <template v-if="filter !== 'mine' && filter !== 'recipes' && !searchView">
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
          @add="(recipe) => pickRecipe(recipe.id)"
          @edit="(recipe) => openRecipeEdit(recipe.id)"
          @create="openRecipeCreate('food')"
        />
        </template>
        <template v-if="filter === 'recipes'" />
        <template v-else-if="filter === 'mine'">
          <div v-if="mine.length" class="row lhead">
            <span class="t-cap c2 section-title">My foods</span>
            <span class="grow" />
            <button type="button" class="btn sm secondary t-label" @click="openNewFood(trimmedQuery || undefined)"><Icon name="plus" :size="14" :sw="2.4" /> New food</button>
          </div>
          <div v-if="!mine.length" class="col emptyc">
            <span class="t-bodys">{{ myFoodsEmptyTitle }}</span>
            <span class="t-label c2">{{ myFoodsEmptyDetail }}</span>
            <button type="button" class="btn sm primary t-label" @click="openNewFood()"><Icon name="plus" :size="14" :sw="2.4" /> Create a food</button>
          </div>
          <div v-for="(food, index) in mineListed" :key="food.id" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @mouseenter="hi = index">
            <button type="button" class="col grow rtext" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)">
              <span class="t-body ell">{{ food.name }}</span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </button>
            <MicroRing :nutrients="food.nutrients" />
            <button type="button" class="cbtn"  :aria-label="`Edit ${food.name}`" @click="editMine(food, 'list')"><Icon name="edit" :size="17" /></button>
            <button type="button" class="cbtn filled"  :aria-label="needTime ? `Pick a time to add ${food.name}` : `Add ${foodAmount(Number(listedPreset(food).amount), listedPreset(food).unit)} ${food.name}`" :disabled="saving || needTime" @click="addListed(food)">
              <Icon :name="justAdded === food.id ? 'check' : 'plus'" :size="18" :sw="2.4" />
            </button>
          </div>
          <p v-if="mine.length && !mineListed.length" class="t-label c2 empty">No match in my foods.</p>
        </template>
        <template v-else-if="!trimmedQuery">
          <div class="row lhead">
            <span class="t-cap c2 section-title">Recent</span>
            <span class="grow" />
            <span class="t-capn c2">{{ keyboardEntry ? recentHintKeys : recentHintTouch }}</span>
          </div>
          <div v-for="(food, index) in recents" :key="food.id" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @mouseenter="hi = index">
            <button type="button" class="col grow rtext" @pointerdown="pressFood($event, food, { amount: food.amount, unit: food.unit })" @click="pickFood($event, food, { amount: food.amount, unit: food.unit })">
              <span class="row gap6 nm"><span class="t-body ell">{{ foodTitle(food, foodCountry()) }}</span><span v-if="isMyFood(food)" class="tag t-capn">my food</span><span v-else-if="countryTag(food, foodCountry())" class="tag t-capn">{{ countryTag(food, foodCountry()) }}</span></span>
              <span class="t-label c2 ell">{{ withBrand(food.brand, recentSubtitle(food, food.amount, food.unit, foodUnit())) }}</span>
            </button>
            <MicroRing :nutrients="food.nutrients" />
            <button type="button" class="cbtn filled"  :aria-label="needTime ? `Pick a time to add ${food.name}` : `Add ${foodAmount(food.amount, food.unit)} ${food.name}`" :disabled="saving || needTime" @click="addRecent(food)">
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
            <button v-if="trimmedQuery.length >= 2" type="button" class="btn sm primary t-label" @click="runSearch(trimmedQuery)"><Icon name="refresh" :size="14" /> Try again</button>
          </div>
          <div v-if="results.length" class="row lhead"><span class="t-cap c2 section-title">Results</span><span v-if="spelling" class="t-capn c2 ell grow spell">{{ spelling }}</span></div>
          <button v-for="(food, index) in results" :key="food.id" type="button" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)" @mouseenter="hi = index">
            <span class="col grow rtext">
              <span class="row gap6 nm"><span class="t-body ell">{{ foodTitle(food, foodCountry()) }}</span><span v-if="isMyFood(food)" class="tag t-capn">my food</span><span v-else-if="countryTag(food, foodCountry())" class="tag t-capn">{{ countryTag(food, foodCountry()) }}</span></span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </span>
            <MicroRing :nutrients="food.nutrients" />
          </button>
          <div v-if="off.results.length" class="row lhead"><span class="t-cap c2 section-title">Open Food Facts</span></div>
          <button v-for="food in off.results" :key="food.id" type="button" class="rrow row" @pointerdown="pressFood($event, food)" @click="pickFood($event, food)">
            <span class="col grow rtext">
              <span class="t-body ell">{{ food.name }}</span>
              <span class="t-label c2 ell">{{ rowSub(food) }}</span>
            </span>
            <MicroRing :nutrients="food.nutrients" />
          </button>
          <p v-if="off.status === 'loading'" class="t-capn c2 skl" role="status">Searching Open Food Facts…</p>
          <div v-else-if="offCopy" class="err col" role="alert">
            <div class="row gap8"><Icon name="alert" :size="18" class="c2" /><span class="t-bodys">{{ offCopy.title }}</span></div>
            <span class="t-label c2">{{ offCopy.detail }}</span>
            <div class="row offacts">
              <button type="button" class="btn sm primary t-label" @click="askOff"><Icon name="refresh" :size="14" /> {{ offCopy.retry }}</button>
              <button type="button" class="btn sm secondary t-label" @click="useQuickAdd">{{ offCopy.quickAdd }}</button>
            </div>
          </div>
          <p v-if="off.status === 'ok' && off.missingKcal > 0" class="t-label c2 miss">
            {{ missingKcalLead }}
            <button type="button" class="btn sm secondary t-label" @click="openMissingEditor">{{ missingKcalAction }}</button>
          </p>
          <div v-if="showNoMatch" class="col emptyc">
            <span class="t-label c2">No match for “{{ trimmedQuery }}”.</span>
            <div class="row gap8 wrapc">
              <button type="button" class="btn sm secondary t-label" @click="openNewFood(trimmedQuery)"><Icon name="plus" :size="14" :sw="2.4" /> Create “{{ trimmedQuery }}”</button>
              <button type="button" class="btn sm secondary t-label" @click="useQuickAdd">Quick Add</button>
            </div>
          </div>
          <button v-if="showOffButton" type="button" class="btn sm secondary t-label offask" @click="askOff"><Icon name="search" :size="14" /> Search Open Food Facts</button>
        </template>
        <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
      </div>
      <!-- Hidden while the search field has the keyboard: the list needs that room, and Done isn't needed mid-typing. -->
      <div v-if="added.length" v-show="!searchFocused" class="well session" role="group" aria-label="Added" data-session data-toast-floor>
        <span class="col stext" role="status">
          <span class="t-bodys">{{ addedLines.title }}</span>
          <span class="t-capn c2">{{ addedLines.sub }}</span>
        </span>
        <!-- Home's rows: two show (one with large text), the rest scroll inside the card so the search keeps its room. -->
        <CappedList :max-rows="addedCap" :watch-key="added.length" class="arows" data-added-rows>
          <LogRow
            v-for="entry in added"
            :key="entry.idempotencyKey"
            :entry="entry"
            :selected="ui.addedPick.selected.includes(entry.id)"
            :selecting="picking"
            oneline
            @tap="tapAdded(entry, $event)"
            @check="checkAdded(entry, $event)"
            @copy="copyAdded([entry], true)"
            @delete="deleteAdded([entry])"
            @hold="holdAdded(entry)"
          />
        </CappedList>
        <!-- Selecting swaps the buttons in place: the same three spots, so nothing moves. -->
        <span v-if="picking" class="sbtns" :style="buttonsHeight ? { minHeight: `${buttonsHeight}px` } : undefined">
          <button type="button" class="btn sm secondary t-label" :disabled="!picked.length" @click="copyAdded(picked, false)">
            <Icon name="copy" :size="14" /> <span>Copy to…</span>
          </button>
          <button type="button" class="btn sm secondary t-label" :disabled="!picked.length" @click="deleteAdded(picked)">
            <Icon name="trash" :size="14" /> <span>Delete</span>
          </button>
          <button type="button" class="btn sm primary t-label" @click="endAddedPick"><Icon name="check" :size="14" :sw="2.4" /> Done</button>
        </span>
        <span v-else ref="buttonsEl" class="sbtns">
          <button v-if="canSaveGroup(added.length)" type="button" class="btn sm secondary t-label" @click="saveSessionGroup">
            <Icon name="layers" :size="14" /> <span>Save as group</span>
          </button>
          <button v-if="canSaveRecipe(sessionRecipeCount)" type="button" class="btn sm secondary t-label" @click="saveSessionRecipe">
            <Icon name="food" :size="14" /> <span>Save as recipe</span>
          </button>
          <button type="button" class="btn sm primary t-label" @click="closeSheet"><Icon name="check" :size="14" :sw="2.4" /> Done</button>
        </span>
      </div>
    </template>

    <div v-else class="body">
      <label class="field row">
        <input v-model="qName" class="t-body grow" type="text" placeholder="Protein bar" aria-label="Name (optional)" autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="keyboardEntry && addQuick()" />
        <span class="t-capn" :class="qSaveNeedsName ? '' : 'c2'">{{ qSave ? "name · needed" : "name · optional" }}</span>
      </label>
      <div class="qgrid">
        <template v-if="keyboardEntry">
          <label v-for="field in fields" :key="'k' + field.key" class="qf" :class="{ on: active === field.key }">
            <span class="t-capm c2">{{ field.label }}</span>
            <span class="base">
              <input v-autofocus="field.key === 'kcal'" :value="qa[field.key]" class="t-nm num qinput" inputmode="decimal" autocomplete="off" :aria-label="field.label"
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
      <label v-if="!editing" class="well qsave row">
        <input v-model="qSave" type="checkbox" />
        <span class="col"><span class="t-label">Also save as my food</span><span class="t-capn" :class="qSaveNeedsName ? '' : 'c2'">{{ qSaveNeedsName ? "! Add a name above to save it" : "One tap next time · saved per serving · private" }}</span></span>
      </label>
      <button v-else type="button" class="btn sm secondary t-label save-link" @click="openSeedEditor">Save as my food…</button>
      <div class="grow" />
      <p v-if="formError" class="err t-label" role="alert">{{ formError }}</p>
      <div v-if="saveError" class="err row" role="alert">
        <Icon name="alert" :size="18" class="c2" />
        <span class="col grow">
          <span class="t-bodys">Needs a connection</span>
          <span class="t-label c2">Saving to your foods needs a connection. Nothing was lost. Try again once you\'re back online.</span>
        </span>
        <button type="button" class="btn sm secondary t-label" @click="saveError = false">Dismiss</button>
      </div>
      <Keypad v-if="!keyboardEntry" data-toast-floor @key="qKey" />
      <p v-else class="t-capn c3 khint keyhint"><kbd>Tab</kbd> next field · <kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> close</p>
      <OfflineNote :entry="editing" />
      <div class="row gap8 actions" data-toast-floor>
        <button v-if="editing && editing.queued !== 'failed'" type="button" class="btn secondary t-bodys" aria-label="Copy to another day" :disabled="saving" @click="copyEdited">
          <Icon name="copy" :size="16" /><span>Copy</span>
        </button>
        <button v-if="editing" type="button" class="btn secondary t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button type="button" class="btn primary block t-bodys grow" :disabled="saving || (!editing && needTime) || !qKcal || qSaveNeedsName" @click="addQuick">
          {{ saveError ? "Try again" : addVerb }}<template v-if="!needTime"> · {{ int(qKcal) }} kcal</template>
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-m); min-width: 0; flex-wrap: wrap; align-items: center; }
.needt { margin: 0; display: flex; align-items: center; gap: var(--space-s); color: var(--text-secondary); }
.gap2 { gap: var(--space-2xs); }
.gap8 { gap: var(--space-s); }
.field { flex: none; }
.field input::-webkit-search-cancel-button { display: none; }
.list { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-m); }
.rrow { min-height: 56px; width: 100%; gap: var(--space-m); padding: var(--space-s) 0; border-bottom: 1px solid var(--color-border); text-align: left; background: transparent; }
.list.compact .rrow { min-height: 40px; padding: var(--space-2xs) 0; gap: var(--space-s); }
.list.compact .rtext { min-height: 0; }
.rrow.hl { background: var(--color-surface-2); border-radius: var(--radius-m); }
.rtext { gap: var(--space-2xs); min-width: 0; align-items: flex-start; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.scanb { color: var(--text-primary); }
.clr { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.qgrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-s); flex: none; min-width: 0; }
.qf { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2xs); padding: var(--space-m) var(--space-l); min-height: 72px; border-radius: var(--radius-m); background: var(--color-surface-2); text-align: left; min-width: 0; box-shadow: var(--d-sunk); }
.qf.on, .qf:focus-within { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.qinput { width: 8ch; min-width: 0; max-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; }
.qinput::placeholder { color: var(--text-tertiary); }
.note, .khint { margin: 0; }
.khint { text-align: center; }
.err { gap: var(--space-m); padding: var(--space-l); border-radius: var(--radius-l); border: 1px dashed var(--text-tertiary); flex: none; min-width: 0; }
.err.t-label { margin: 0; }
.emptyc { gap: var(--space-s); padding: var(--space-m) 0 var(--space-xl); }
.lhead { padding: var(--space-m) 0 var(--space-2xs); }
.spell { text-align: right; padding-left: var(--space-m); }
.rtext { min-height: 44px; justify-content: center; }
.miss { margin: var(--space-s) 0; }
.offacts { gap: var(--space-s); flex-wrap: wrap; }
.offask { align-self: flex-start; margin: var(--space-s) 0; }
.skl { padding: var(--space-m) 0; }
.actions { flex: none; flex-wrap: wrap; }
/* As on the amount screen: Copy, Delete and Save in one row. */
.actions .btn { padding-inline: var(--space-m); }
.actions .btn.primary { width: auto; flex: 1 1 auto; min-width: 0; }
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; gap: var(--space-s); flex-wrap: wrap; }
/* The Home nutrient card, the same size, on the sheet's grey. */
.headcol { display: flex; flex-direction: column; gap: var(--space-m); }
.session { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-s); flex: none; min-width: 0; max-width: 100%; box-sizing: border-box; }
.stext { min-width: 0; }
/* Home's dividers: a line above, between and below the rows. The list sits in the card's padding sideways. */
.session :deep(.arows) { border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
.session :deep(.arows > .swipe:not(:first-child)) { border-top: 1px solid var(--color-border); }
.sbtns { display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--space-s); margin: 0; min-width: 0; max-width: 100%; }
/* A label that wraps keeps 8px above and below it inside the pill. */
.sbtns .btn { flex: 1 1 0; min-width: 0; padding-block: calc(var(--inset) + var(--space-s)); }
.sbtns .btn span { min-width: 0; }
html.dt-xl .sbtns .btn { flex-basis: 100%; }
/* The header stays near the default size so the largest text cannot cover it.
   The sheet body can still scroll. (The amount screen does the same for its name and amount.) */
html.dt-xl .hdr { flex-wrap: nowrap; }
html.dt-xl .hdr :deep(.tchip.t-label),
html.dt-xl .hdr :deep(.now) { font-size: 15px; line-height: 1.2; }
.dt-xl .qgrid { grid-template-columns: 1fr; }
.fchips { gap: var(--space-m); flex-wrap: wrap; flex: none; }
.offwell { display: flex; align-items: flex-start; gap: var(--space-s); margin: var(--space-s) 0 0; flex: none; }
.offwell .oic { flex: none; margin-top: 2px; }
.offk { color: var(--text-primary); font-weight: 600; }
.nm { min-width: 0; max-width: 100%; }
.gap6 { gap: var(--space-s); }
.wrapc { flex-wrap: wrap; justify-content: center; }
.qsave { gap: var(--space-m); align-items: flex-start; cursor: pointer; flex: none; }
.qsave input { width: 22px; height: 22px; margin-top: var(--space-2xs); accent-color: var(--color-action); flex: none; }
.save-link { align-self: flex-start; padding: var(--space-s) 0; }
.empty { margin: 0; padding: var(--space-s) 0; }
</style>
