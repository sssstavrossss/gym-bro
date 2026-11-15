<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getFood, listMyFoods, searchFoods, type FoodSearchRow, type RecipeIngredient } from "../api";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import TimeChip from "./TimeChip.vue";
import { dayMonth, todayInZone } from "../lib/dates";
import { amountError, amountLabel, convertAmount, defaultAmount, distinctUnits, parseAmount, servingName, unitsForFood, type CatalogFood, type UnitChoice } from "../lib/foodAmount";
import { int } from "../lib/format";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../lib/foodSearch";
import { addNeedsTime, logTimeForAdd } from "../lib/foodSheet";
import { bindPick, clickPick } from "../lib/cleanTap";
import { armReplace, primeKeyboard, selectField } from "../lib/focusField";
import { afterInsertion, markWholeSelection, nextQuickInput, nextQuickNumber, tookWholeSelection } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";
import {
  cleanRecipeName,
  finishedError,
  ingredientMacros,
  perPortion,
  perPortionSentence,
  portionGrams,
  portionsError,
  presetFromLogged,
  recipeLogProblem,
  recipeMacro,
  recipeNameError,
  recipeNameMax,
  scaleRecipeLog,
  scaleStoredLine,
  selectionSkipNote,
  sumTotals,
  type RecipeLogInput,
  type RecipeTotals,
} from "../lib/recipes";
import { deviceTimeZone } from "../state/profile";
import { findEntry, viewed } from "../state/log";
import { deleteRecipeWithUndo, fetchRecipe, logSavedRecipe, saveRecipe } from "../state/recipes";
import { closeRecipeSheet, finishRecipeSave, toast, ui } from "../ui";

interface DraftLine {
  key: string;
  foodId: string;
  name: string;
  amountText: string;
  unit: string;
  available: boolean;
  food: CatalogFood | null;
  stored: (RecipeTotals & { amount: number; unit: string }) | null;
}

const open = computed(() => ui.sheet === "recipe");
const mode = computed(() => ui.recipeMode);
const fromSelection = computed(() => mode.value === "create" && ui.recipeEntryIds.length > 0);
const title = computed(() => {
  if (mode.value === "log") return loadedName.value ? `Log ${loadedName.value}` : "Log recipe";
  if (mode.value === "edit") return "Edit recipe";
  return fromSelection.value ? "Save as recipe" : "New recipe";
});
const step = ref<"form" | "search" | "amount">("form");
const name = ref("");
const portionsText = ref("");
const finishedText = ref("");
const lines = ref<DraftLine[]>([]);
const notice = ref("");
const error = ref("");
const saving = ref(false);
const loading = ref(false);
const loadedName = ref("");
const recipeId = ref<string | null>(null);
const q = ref("");
const mine = ref<FoodSearchRow[]>([]);
const results = ref<FoodSearchRow[]>([]);
const searching = ref(false);
const picked = ref<CatalogFood | null>(null);
const pickAmount = ref("100");
const pickUnit = ref("g");
const logAmount = ref("1");
const logUnit = ref<"portion" | "g">("portion");
const time = ref<string | null>(null);
const logKey = ref("");
const snapshot = ref<RecipeLogInput | null>(null);
/** Name takes focus only when the form first opens, not each time it comes back from adding an ingredient. */
const focusName = ref(true);
let searchGen = 0;
let searchTimer = 0;

const foodToday = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const pastDay = computed(() => ui.foodDate !== foodToday.value);
const needTime = computed(() => addNeedsTime(ui.foodDate, foodToday.value, time.value, false));
const portions = computed(() => parseAmount(portionsText.value));
const finished = computed(() => (finishedText.value.trim() ? parseAmount(finishedText.value) : null));
const nameProblem = computed(() => recipeNameError(name.value));
const portionsProblem = computed(() => (portionsText.value.trim() ? portionsError(portions.value) : "Enter portions above 0 and at most 1,000."));
const finishedProblem = computed(() => finishedError(finished.value));

function macrosOf(line: DraftLine): RecipeTotals | null {
  const amount = parseAmount(line.amountText);
  if (line.food) return ingredientMacros(line.food, amount, line.unit);
  if (line.stored && line.unit === line.stored.unit) return scaleStoredLine(line.stored, amount);
  return null;
}
const lineMacros = computed(() => lines.value.map((line) => macrosOf(line)));
/** A line with an unusable amount would silently drop out of the sum, so the sum is not shown until it is fixed. */
const linesOk = computed(() => lineMacros.value.every((row) => row !== null));
const total = computed(() => sumTotals(lineMacros.value.filter((row): row is RecipeTotals => row !== null)));
const per = computed(() => (portionsProblem.value || !linesOk.value ? null : perPortion(total.value, portions.value)));
const sentence = computed(() => (per.value ? perPortionSentence(per.value) : ""));
const formReady = computed(() =>
  !nameProblem.value
  && !portionsProblem.value
  && !finishedProblem.value
  && lines.value.length > 0
  && lineMacros.value.every((row) => row !== null));

const logPreview = computed(() => (
  snapshot.value ? scaleRecipeLog(snapshot.value, parseAmount(logAmount.value), logUnit.value) : null
));
const logProblem = computed(() => (snapshot.value ? recipeLogProblem(snapshot.value, parseAmount(logAmount.value), logUnit.value) : null));
const eachPortion = computed(() => (snapshot.value ? portionGrams(snapshot.value) : null));
const logFigures = computed(() => {
  const preview = logPreview.value;
  return [
    { label: "KCAL", value: preview ? int(preview.kcal) : "–" },
    { label: "PROTEIN", value: preview ? recipeMacro(preview.protein) : "–" },
    { label: "FAT", value: preview ? recipeMacro(preview.fat) : "–" },
    { label: "CARBS", value: preview ? recipeMacro(preview.carbs) : "–" },
  ];
});
const logChips = computed(() => {
  if (logUnit.value === "portion") return [0.5, 1, 2];
  const full = finished.value;
  const chips = [100, 150, 200];
  if (full != null && full > 0 && full <= 10000 && !chips.includes(full)) chips.push(full);
  return chips;
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  void reset();
});

async function reset() {
  step.value = "form";
  name.value = "";
  portionsText.value = "";
  finishedText.value = "";
  lines.value = [];
  notice.value = "";
  error.value = "";
  saving.value = false;
  loading.value = false;
  loadedName.value = "";
  recipeId.value = ui.recipeId;
  q.value = "";
  results.value = [];
  picked.value = null;
  logAmount.value = "1";
  logUnit.value = "portion";
  time.value = null;
  logKey.value = "";
  snapshot.value = null;
  padTarget.value = null;
  focusName.value = true;
  if (mode.value === "edit" || mode.value === "log") {
    if (!ui.recipeId) return;
    loading.value = true;
    const result = await fetchRecipe(ui.recipeId);
    loading.value = false;
    if (!open.value || ui.recipeId !== recipeId.value) return;
    if (!result.ok) {
      error.value = result.message;
      return;
    }
    fillRecipe(result.recipe);
    if (mode.value === "edit") await hydrateFoods();
  } else if (ui.recipeEntryIds.length) {
    await fillFromEntries();
  }
}

function fillRecipe(recipe: { id: string; name: string; portions: number; finishedGrams: number | null; kcal: number; protein: number; fat: number; carbs: number; notice: string; ingredients: RecipeIngredient[] }) {
  loadedName.value = recipe.name;
  snapshot.value = {
    portions: recipe.portions,
    finishedGrams: recipe.finishedGrams,
    kcal: recipe.kcal,
    protein: recipe.protein,
    fat: recipe.fat,
    carbs: recipe.carbs,
  };
  name.value = recipe.name;
  portionsText.value = String(recipe.portions);
  finishedText.value = recipe.finishedGrams == null ? "" : String(recipe.finishedGrams);
  notice.value = recipe.notice;
  lines.value = recipe.ingredients.map((item) => ({
    key: item.id,
    foodId: item.foodId,
    name: item.name,
    amountText: String(item.amount),
    unit: item.unit,
    available: item.available,
    food: null,
    stored: {
      amount: item.amount,
      unit: item.unit,
      kcal: item.kcal,
      protein: item.protein,
      fat: item.fat,
      carbs: item.carbs,
    },
  }));
  if (mode.value === "log") {
    portionsText.value = String(recipe.portions);
    finishedText.value = recipe.finishedGrams == null ? "" : String(recipe.finishedGrams);
  }
}

async function hydrateFoods() {
  const current = lines.value.slice();
  for (const line of current) {
    if (!line.available) continue;
    try {
      const food = await getFood(line.foodId);
      if (!open.value) return;
      line.food = food;
      line.available = true;
    } catch {
      line.available = false;
    }
  }
}

async function fillFromEntries() {
  const entries = ui.recipeEntryIds.map((id) => findEntry(id)).filter((entry) => entry !== null);
  notice.value = selectionSkipNote(entries);
  const leftOut: string[] = [];
  for (const entry of entries) {
    if (entry.source === "quick" || !entry.foodId) continue;
    try {
      const food = await getFood(entry.foodId);
      if (!open.value) return;
      const preset = presetFromLogged(food, entry);
      lines.value.push(draftFrom(food, preset.amount, preset.unit));
    } catch {
      leftOut.push(entry.name);
    }
  }
  if (leftOut.length) {
    const extra = `${leftOut.join(", ")} is no longer available and was left out.`;
    notice.value = notice.value ? `${notice.value} ${extra}` : extra;
  }
}

function draftFrom(food: CatalogFood, amount: string, unit: string): DraftLine {
  return {
    key: crypto.randomUUID(),
    foodId: food.id,
    name: food.name,
    amountText: amount,
    unit,
    available: true,
    food,
    stored: null,
  };
}

function lineSummary(line: DraftLine): string {
  const macros = macrosOf(line);
  if (!macros) return "";
  return `${recipeMacro(macros.protein)} g protein · ${int(macros.kcal)} kcal`;
}

function lineError(line: DraftLine): string | null {
  if (macrosOf(line)) return null;
  if (!line.available) return "That food is no longer available. Keep the saved unit.";
  return amountError(parseAmount(line.amountText), line.unit) ?? "Choose a unit this food can be logged in.";
}

function unitChoices(line: DraftLine): UnitChoice[] {
  return line.food ? distinctUnits(unitsForFood(line.food), line.unit) : [];
}

/** Word next to the amount: the chip's name ("porsjon", "stk"), not the API value ("serving", "piece"). */
function unitWord(unit: string, choices: readonly UnitChoice[]): string {
  const choice = choices.find((item) => item.unit === unit);
  if (!choice) return servingName(unit) ?? unit;
  if (choice.named) return choice.unit;
  return choice.label;
}

/** Switching unit keeps the same amount of food: 600 g becomes 4 × 150 g portions, not 600 portions. */
function setLineUnit(line: DraftLine, next: UnitChoice) {
  if (next.unit === line.unit) return;
  const choices = line.food ? unitsForFood(line.food) : [];
  const current = choices.find((item) => item.unit === line.unit);
  line.amountText = convertAmount(parseAmount(line.amountText), current, next, true);
  line.unit = next.unit;
}

function setPickUnit(next: UnitChoice) {
  if (!picked.value || next.unit === pickUnit.value) return;
  const current = unitsForFood(picked.value).find((item) => item.unit === pickUnit.value);
  pickAmount.value = convertAmount(parseAmount(pickAmount.value), current, next);
  pickUnit.value = next.unit;
}

/** Same food, same size: one portion is finished weight ÷ portions. */
function setLogUnit(next: "portion" | "g") {
  if (next === logUnit.value) return;
  const each = eachPortion.value;
  if (each != null) {
    const portion: UnitChoice = { unit: "portion", label: "portion", gramsEach: each };
    const gram: UnitChoice = { unit: "g", label: "g", gramsEach: 1 };
    const amount = parseAmount(logAmount.value);
    logAmount.value = next === "g" ? convertAmount(amount, portion, gram) : convertAmount(amount, gram, portion);
  }
  logUnit.value = next;
}

function reveal(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  requestAnimationFrame(() => target.scrollIntoView({ block: "nearest" }));
}

function selectAmount(event: FocusEvent) {
  if (event.target instanceof HTMLInputElement) selectField(event.target);
}

const padReplace = ref(false);
const padTarget = ref<"log" | "pick" | "portions" | "finished" | "line" | null>(null);
const padLine = ref<string | null>(null);

function readPad(): string {
  if (padTarget.value === "log") return logAmount.value;
  if (padTarget.value === "pick") return pickAmount.value;
  if (padTarget.value === "portions") return portionsText.value;
  if (padTarget.value === "finished") return finishedText.value;
  if (padTarget.value === "line") return lines.value.find((line) => line.key === padLine.value)?.amountText ?? "";
  return "";
}

function writePad(next: string) {
  if (padTarget.value === "log") logAmount.value = next;
  else if (padTarget.value === "pick") pickAmount.value = next;
  else if (padTarget.value === "portions") portionsText.value = next;
  else if (padTarget.value === "finished") finishedText.value = next;
  else if (padTarget.value === "line") {
    const line = lines.value.find((item) => item.key === padLine.value);
    if (line) line.amountText = next;
  }
}

function onNameFocus(event: FocusEvent) {
  closePad();
  selectAmount(event);
}

/** The keypad sits at the bottom of the sheet, so it says which field it is typing into. */
const padCaption = computed(() => {
  if (padTarget.value === "portions") return `Portions: ${portionsText.value || "–"}`;
  if (padTarget.value === "finished") return `Finished weight: ${finishedText.value || "–"} g`;
  if (padTarget.value === "line") {
    const line = lines.value.find((item) => item.key === padLine.value);
    if (line) return `${line.name}: ${line.amountText || "–"} ${unitWord(line.unit, unitChoices(line))}`;
  }
  return "";
});

function closePad() {
  padTarget.value = null;
  padLine.value = null;
}

function onPadFocus(target: "log" | "pick" | "portions" | "finished" | "line", event: FocusEvent, lineKey?: string) {
  padTarget.value = target;
  padLine.value = lineKey ?? null;
  padReplace.value = true;
  if (event.target instanceof HTMLInputElement) armReplace(event.target);
}

function onPadKey(key: string) {
  writePad(nextQuickNumber(readPad(), key, padReplace.value, 5));
  padReplace.value = false;
}

function onPadInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const replace = padReplace.value;
  afterInsertion(input, (raw) => {
    const next = nextQuickInput(readPad(), raw, replace && !tookWholeSelection(input), 8);
    padReplace.value = false;
    writePad(next);
    if (input.value !== next) input.value = next;
  });
}

function sourceLabel(source: string): string {
  if (source === "custom") return "Your food";
  if (source === "mvt") return "Matvaretabellen";
  if (source === "off") return "Open Food Facts";
  if (source === "kassalapp") return "Kassalapp";
  return "";
}

function foodFacts(food: CatalogFood): string {
  const bits: string[] = [];
  if (food.brand) bits.push(food.brand);
  if (food.nutrientBasis === "per_100" && (food.basis === "g" || food.basis === "ml")) {
    bits.push(`${int(food.kcalPer100)} kcal per 100 ${food.basis}`);
    bits.push(`P ${recipeMacro(food.proteinPer100)} · F ${recipeMacro(food.fatPer100)} · C ${recipeMacro(food.carbsPer100)}`);
  } else if (food.nutrientBasis === "per_serving") {
    bits.push(`${int(food.kcalPer100)} kcal per serving`);
    bits.push(`P ${recipeMacro(food.proteinPer100)} · F ${recipeMacro(food.fatPer100)} · C ${recipeMacro(food.carbsPer100)}`);
  }
  if (food.servingQuantity != null && food.servingLabel) bits.push(`${food.servingQuantity} ${food.servingLabel}`);
  const source = food.source ? sourceLabel(food.source) : "";
  if (source) bits.push(source);
  return bits.join(" · ");
}

function backStep() {
  primeKeyboard();
  closePad();
  if (step.value === "search") focusName.value = false;
  step.value = step.value === "amount" ? "search" : "form";
}

async function openSearch() {
  primeKeyboard();
  closePad();
  step.value = "search";
  q.value = "";
  results.value = [];
  error.value = "";
  try {
    mine.value = (await listMyFoods()).foods;
  } catch {
    mine.value = [];
  }
}

watch(q, (value) => {
  if (step.value !== "search") return;
  window.clearTimeout(searchTimer);
  const plan = preparedSearch(value);
  if (plan.kind !== "query") {
    searchGen += 1;
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  const trimmed = plan.query;
  searchTimer = window.setTimeout(() => { void runSearch(trimmed); }, searchDebounceMs);
});

async function runSearch(trimmed: string) {
  const gen = ++searchGen;
  try {
    const body = await searchFoods(trimmed);
    if (!acceptSearchResult(gen, trimmed, searchGen, q.value)) return;
    results.value = body.foods;
  } catch {
    if (gen === searchGen) results.value = [];
  } finally {
    if (gen === searchGen) searching.value = false;
  }
}

const searchEmpty = computed(() => {
  if (searching.value || searchRows.value.length) return "";
  const query = q.value.trim();
  if (query.length >= 2) return `No foods match “${query}”. Try fewer letters or another word.`;
  return query ? "Type at least 2 letters." : "Search for a food above.";
});
const searchRows = computed(() => (q.value.trim().length >= 2 ? results.value : mine.value.filter((food) => {
  const needle = q.value.trim().toLowerCase();
  return !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);
})));

function pressIngredient(event: PointerEvent, food: FoodSearchRow) {
  bindPick(event, () => { void chooseFood(food); });
}
function pickIngredient(event: MouseEvent, food: FoodSearchRow) {
  clickPick(event, () => { void chooseFood(food); });
}
async function chooseFood(food: FoodSearchRow) {
  primeKeyboard();
  let current: CatalogFood = food;
  try {
    current = { ...food, ...(await getFood(food.id)) };
  } catch {
    current = food;
  }
  if (!open.value) return;
  picked.value = current;
  const start = defaultAmount(current);
  pickAmount.value = start.amount;
  pickUnit.value = start.unit;
  step.value = "amount";
}

const pickMacros = computed(() => (picked.value ? ingredientMacros(picked.value, parseAmount(pickAmount.value), pickUnit.value) : null));
const pickProblem = computed(() => {
  if (!picked.value) return null;
  return amountError(parseAmount(pickAmount.value), pickUnit.value);
});

function addPicked() {
  const food = picked.value;
  if (!food || !pickMacros.value || lines.value.length >= 100) return;
  lines.value.push(draftFrom(food, pickAmount.value, pickUnit.value));
  picked.value = null;
  closePad();
  focusName.value = false;
  step.value = "form";
}

function removeLine(key: string) {
  if (padLine.value === key) closePad();
  lines.value = lines.value.filter((line) => line.key !== key);
}

async function save() {
  if (saving.value || !formReady.value) return;
  saving.value = true;
  error.value = "";
  const result = await saveRecipe({
    name: cleanRecipeName(name.value),
    portions: portions.value,
    finishedGrams: finished.value,
    ingredients: lines.value.map((line) => ({
      foodId: line.foodId,
      amount: parseAmount(line.amountText),
      unit: line.unit,
    })),
  }, mode.value === "edit" ? recipeId.value ?? undefined : undefined);
  saving.value = false;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  const verb = mode.value === "edit" ? "Updated" : "Saved";
  // From the food sheet the list is right behind this sheet, so there is nothing to point to.
  const where = ui.recipeReturn === "food" ? "" : " Find it under Add food → Recipes.";
  toast(`${verb} “${result.recipe.name}” · ${recipeMacro(result.recipe.perPortion.protein)} g protein per portion.${where}`);
  finishRecipeSave();
}

async function removeRecipe() {
  if (saving.value || !recipeId.value) return;
  saving.value = true;
  const removed = await deleteRecipeWithUndo({ id: recipeId.value, name: loadedName.value || name.value }, toast);
  saving.value = false;
  if (!removed) {
    error.value = "Couldn't delete that recipe.";
    return;
  }
  finishRecipeSave();
}

async function addLog() {
  if (saving.value || !recipeId.value || !logPreview.value) return;
  const when = logTimeForAdd(ui.foodDate, foodToday.value, time.value);
  if (!when.ok) {
    error.value = "Pick a time to add";
    return;
  }
  if (!logKey.value) logKey.value = crypto.randomUUID();
  saving.value = true;
  error.value = "";
  const result = await logSavedRecipe(recipeId.value, {
    localDate: ui.foodDate,
    timeZone: deviceTimeZone(),
    time: when.time,
    idempotencyKey: logKey.value,
    amount: parseAmount(logAmount.value),
    unit: logUnit.value,
  });
  saving.value = false;
  if (!result.ok) {
    logKey.value = "";
    error.value = result.message;
    return;
  }
  toast(`Added ${amountLabel(result.entry.amount, result.entry.unit)} ${result.entry.name} · ${recipeMacro(result.entry.protein)} g protein`);
  closeRecipeSheet();
}

</script>

<template>
  <BottomSheet :open="open" :label="title" full @close="closeRecipeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="step !== 'form'" type="button" class="cbtn" aria-label="Back" @click="backStep">
          <Icon name="left" :size="18" />
        </button>
        <h2 class="t-head grow">{{ step === "search" ? "Add ingredient" : step === "amount" ? (picked?.name || "Amount") : title }}</h2>
        <TimeChip v-if="mode === 'log' && step === 'form'" v-model="time" :date="ui.foodDate" :today="foodToday" />
        <button type="button" class="cbtn" aria-label="Close" @click="closeRecipeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
    </template>

    <p v-if="loading" class="t-label c2" role="status">Loading…</p>

    <div v-else-if="mode === 'log'" class="stack" @focusin="reveal">
      <p v-if="needTime" class="t-label need" role="status">Logging to {{ dayMonth(ui.foodDate) }} — pick the time you ate it.</p>
      <p class="t-label c2">The logged entry keeps these numbers. Later edits to the recipe do not change it.</p>
      <div class="preview" aria-live="polite">
        <div v-for="item in logFigures" :key="item.label" class="col center">
          <span class="t-nm num">{{ item.value }}</span>
          <span class="t-cap c2">{{ item.label }}</span>
        </div>
      </div>
      <label class="field row">
        <span class="t-label c2">Amount</span>
        <input v-autofocus :value="logAmount" data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" aria-label="Amount to log" @focus="onPadFocus('log', $event)" @beforeinput="markWholeSelection" @input="onPadInput" />
        <span class="t-label c2">{{ logUnit === "g" ? "g" : "portion" }}</span>
      </label>
      <div class="row units" role="radiogroup" aria-label="Log by">
        <button type="button" class="chip t-label" role="radio" :class="{ on: logUnit === 'portion' }" :aria-checked="logUnit === 'portion'" @click="setLogUnit('portion')">portion</button>
        <button v-if="snapshot?.finishedGrams" type="button" class="chip t-label" role="radio" :class="{ on: logUnit === 'g' }" :aria-checked="logUnit === 'g'" @click="setLogUnit('g')">grams</button>
      </div>
      <p v-if="eachPortion" class="t-label c2" data-recipe-each>1 portion = {{ int(eachPortion) }} g</p>
      <div class="row chips">
        <button v-for="amount in logChips" :key="amount" type="button" class="chip t-label" @click="logAmount = String(amount)">{{ amountLabel(amount, logUnit === "g" ? "g" : "portion") }}</button>
      </div>
      <div v-if="!keyboardEntry" class="pad" @mousedown.prevent><Keypad @key="onPadKey" /></div>
      <p v-if="logPreview" class="t-bodys">{{ recipeMacro(logPreview.protein) }} g protein in this log</p>
      <p v-else-if="logProblem" class="t-label err" role="status">{{ logProblem }}</p>
    </div>

    <div v-else-if="step === 'search'" class="stack search">
      <label class="field row finder">
        <Icon name="search" :size="18" class="c2" />
        <input v-autofocus v-model="q" class="t-body grow" type="search" placeholder="Search foods" aria-label="Search foods" autocomplete="off" />
      </label>
      <p v-if="searching" class="t-label c2" role="status">Searching…</p>
      <button v-for="food in searchRows" :key="food.id" type="button" class="rrow row" @pointerdown="pressIngredient($event, food)" @click="pickIngredient($event, food)">
        <span class="col grow rtext">
          <span class="t-body name">{{ food.name }}</span>
          <span class="t-label c2 facts">{{ foodFacts(food) }}</span>
        </span>
      </button>
      <p v-if="searchEmpty" class="t-label c2" role="status">{{ searchEmpty }}</p>
    </div>

    <div v-else-if="step === 'amount' && picked" class="stack" @focusin="reveal">
      <label class="field row">
        <span class="t-label c2">Amount</span>
        <input v-autofocus :value="pickAmount" data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Amount of ${picked.name}`" @focus="onPadFocus('pick', $event)" @beforeinput="markWholeSelection" @input="onPadInput" @keydown.enter.prevent="addPicked" />
        <span class="t-label c2">{{ unitWord(pickUnit, unitsForFood(picked)) }}</span>
      </label>
      <div class="row units" role="radiogroup" :aria-label="`Unit for ${picked.name}`">
        <button
          v-for="choice in distinctUnits(unitsForFood(picked), pickUnit)"
          :key="choice.unit"
          type="button"
          class="chip t-label"
          role="radio"
          :class="{ on: pickUnit === choice.unit }"
          :aria-checked="pickUnit === choice.unit"
          @click="setPickUnit(choice)"
        >{{ choice.label }}</button>
      </div>
      <div v-if="!keyboardEntry" class="pad" @mousedown.prevent><Keypad @key="onPadKey" /></div>
      <p v-if="pickMacros" class="t-bodys" aria-live="polite">{{ recipeMacro(pickMacros.protein) }} g protein · {{ int(pickMacros.kcal) }} kcal</p>
      <p v-else-if="pickProblem" class="t-label err" role="status">{{ pickProblem }}</p>
    </div>

    <div v-else class="stack" @focusin="reveal">
      <p v-if="notice" class="t-label note" role="status">{{ notice }}</p>
      <label class="field row">
        <span class="t-label c2">Name</span>
        <input v-autofocus="focusName" v-model="name" class="t-body grow" type="text" placeholder="Weeknight stew" :maxlength="recipeNameMax" autocomplete="off" aria-label="Recipe name" @focus="onNameFocus" />
      </label>
      <label class="field row">
        <span class="t-label c2">Portions</span>
        <input :value="portionsText" data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" aria-label="Portions" placeholder="e.g. 5" @focus="onPadFocus('portions', $event)" @beforeinput="markWholeSelection" @input="onPadInput" />
      </label>
      <label class="field row">
        <span class="t-label c2">Finished weight</span>
        <input :value="finishedText" data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" aria-label="Finished weight in grams, optional" placeholder="Optional, grams" @focus="onPadFocus('finished', $event)" @beforeinput="markWholeSelection" @input="onPadInput" />
      </label>
      <p class="t-label c2">Calories and macros are worked out from the foods. They update as you change ingredients, amounts, or portions.</p>
      <button type="button" class="add-btn t-bodys" @click="openSearch">
        <Icon name="plus" :size="16" :sw="2.4" /> Add ingredient
      </button>
      <div v-if="!lines.length" class="empty col">
        <span class="t-bodys">No ingredients yet</span>
        <span class="t-label c2">Add a food. The total and the amount per portion appear as you go.</span>
      </div>
      <div v-else class="items col">
        <div v-for="(line, index) in lines" :key="line.key" class="ing" :data-ingredient-index="index">
          <div class="ingrow">
            <span class="ingtext">
              <span class="t-body name" :title="line.name">{{ line.name }}</span>
              <span v-if="lineSummary(line)" class="t-label c2">{{ lineSummary(line) }}</span>
              <span v-else class="t-label err" role="status">{{ lineError(line) }}</span>
            </span>
            <label class="amt">
              <input :value="line.amountText" data-replace="1" class="t-body num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Amount of ${line.name}`" :readonly="!line.available && !line.stored" @focus="onPadFocus('line', $event, line.key)" @beforeinput="markWholeSelection" @input="onPadInput" />
              <span class="t-label c2">{{ unitWord(line.unit, unitChoices(line)) }}</span>
            </label>
            <button type="button" class="cbtn" :aria-label="`Remove ${line.name}`" @click="removeLine(line.key)">
              <Icon name="x" :size="16" />
            </button>
          </div>
          <p v-if="!line.available" class="t-label c2 gone">No longer available. Saved totals stay until you remove it.</p>
          <div v-if="unitChoices(line).length > 1" class="row units" role="radiogroup" :aria-label="`Unit for ${line.name}`">
            <button
              v-for="choice in unitChoices(line)"
              :key="choice.unit"
              type="button"
              class="chip t-label"
              role="radio"
              :class="{ on: line.unit === choice.unit }"
              :aria-checked="line.unit === choice.unit"
              @click="setLineUnit(line, choice)"
            >{{ choice.label }}</button>
          </div>
        </div>
      </div>
      <p v-if="nameProblem && name.trim()" class="t-label err" role="status">{{ nameProblem }}</p>
      <p v-if="portionsText.trim() && portionsProblem" class="t-label err" role="status">{{ portionsProblem }}</p>
      <p v-if="finishedProblem" class="t-label err" role="status">{{ finishedProblem }}</p>
    </div>

    <template v-if="!loading && mode === 'log'" #footer>
      <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
      <button type="button" class="primary-btn t-bodys" :disabled="saving || !logPreview || needTime" @click="addLog">
        {{ saving ? "Adding…" : needTime ? "Pick a time to add" : logPreview ? `Add · ${int(logPreview.kcal)} kcal` : "Add" }}
      </button>
    </template>
    <template v-else-if="!loading && step === 'amount' && picked" #footer>
      <button type="button" class="primary-btn t-bodys" :disabled="!pickMacros" @click="addPicked">Add to recipe</button>
    </template>
    <template v-else-if="!loading && step === 'form'" #footer>
      <div v-if="!keyboardEntry && padTarget" class="padwrap" data-recipe-pad @mousedown.prevent>
        <div class="row padhead">
          <span class="t-label c2 grow padcap" aria-live="polite">{{ padCaption }}</span>
          <button type="button" class="chip t-label" @click="closePad">Done</button>
        </div>
        <Keypad @key="onPadKey" />
        <p class="t-label c2 sumline" aria-live="polite" data-recipe-sumline>
          Total {{ linesOk ? int(total.kcal) : "–" }} kcal · per portion {{ per ? int(per.kcal) : "–" }} kcal<template v-if="per"> · P {{ recipeMacro(per.protein) }}</template>
        </p>
      </div>
      <div v-else class="sum" aria-live="polite">
        <div class="metric">
          <span class="t-cap c2">Total</span>
          <span class="t-nm num">{{ linesOk ? int(total.kcal) : "–" }}</span>
          <span class="t-label c2">kcal</span>
          <span v-if="linesOk" class="t-label c2">P {{ recipeMacro(total.protein) }} · F {{ recipeMacro(total.fat) }} · C {{ recipeMacro(total.carbs) }}</span>
          <span v-else class="t-label c2">Fix the amount marked above.</span>
        </div>
        <div class="metric">
          <span class="t-cap c2">Per portion</span>
          <span class="t-nm num">{{ per ? int(per.kcal) : "–" }}</span>
          <span class="t-label c2">kcal</span>
          <span v-if="per" class="t-label c2" data-recipe-portion>P {{ recipeMacro(per.protein) }} · F {{ recipeMacro(per.fat) }} · C {{ recipeMacro(per.carbs) }}</span>
          <span v-else-if="linesOk" class="t-label c2">Enter portions to see the amount per portion.</span>
        </div>
        <p v-if="per" class="sr-only">{{ sentence }} · {{ recipeMacro(per.fat) }} g fat · {{ recipeMacro(per.carbs) }} g carbs · {{ int(per.kcal) }} kcal</p>
      </div>
      <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
      <button type="button" class="primary-btn t-bodys" :disabled="saving || !formReady" @click="save">
        {{ saving ? "Saving…" : "Save recipe" }}
      </button>
      <button v-if="mode === 'edit'" type="button" class="t-label gdel" :disabled="saving" @click="removeRecipe">
        <Icon name="trash" :size="14" /> Delete recipe
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-gap); min-width: 0; align-items: center; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.field { min-height: 44px; padding: 0 12px; gap: 8px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; width: 100%; padding: 0; color: var(--text-primary); }
.field input::placeholder { color: var(--text-tertiary); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.finder { position: sticky; top: 0; z-index: 1; }
.preview { display: flex; justify-content: space-around; gap: 8px; padding: 14px 8px; border-radius: var(--radius-card); background: var(--color-surface-2); }
.center { align-items: center; text-align: center; flex: 1; min-width: 0; }
.sum { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; padding: 12px; border-radius: var(--radius-card); background: var(--color-surface-2); }
.metric { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; text-align: left; }
.metric .num { text-align: left; }
.items { gap: 0; }
.ing { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--color-border); }
.ingrow { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; gap: 8px; align-items: center; min-height: 44px; }
.ingtext { display: flex; flex-direction: column; min-width: 0; }
.ingtext .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 8px; border-radius: 12px; background: var(--color-surface-2); }
.amt input { width: 4.5rem; min-height: 44px; border: 0; background: transparent; padding: 0; color: var(--text-primary); }
.gone { margin: 0; }
.empty { gap: 4px; padding: 8px 2px 4px; }
.units, .chips { gap: 8px; flex-wrap: wrap; }
.rrow { min-height: 56px; width: 100%; gap: 8px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--color-border); background: transparent; text-align: left; }
.rtext { gap: 2px; min-width: 0; align-items: flex-start; }
.name, .facts { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.pad { margin-top: var(--space-gap); }
.padwrap { display: flex; flex-direction: column; gap: 8px; }
.padhead { align-items: center; gap: 8px; min-width: 0; }
.sumline { margin: 0; }
.padcap { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.err, .note, .need { margin: 0; }
.add-btn {
  min-height: 44px; width: 100%; border-radius: var(--radius-control);
  border: 1px dashed var(--color-border-strong); color: var(--text-primary);
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: transparent;
}
.gdel { align-self: flex-start; min-height: 44px; padding: 8px 0; display: inline-flex; align-items: center; gap: 6px; text-decoration: underline; text-underline-offset: 3px; background: transparent; color: var(--text-primary); }
</style>
