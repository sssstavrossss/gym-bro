<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getFood, listMyFoods, listRecentFoods, searchFoods, type FoodSearchRow, type RecentFood, type Recipe, type RecipeIngredient } from "../api";
import AmountScreen, { type AmountChip, type AmountUnit } from "./AmountScreen.vue";
import BottomSheet from "./BottomSheet.vue";
import FoodAmountView from "./FoodAmountView.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import MicroRing from "./MicroRing.vue";
import NutrientCard from "./NutrientCard.vue";
import TimeChip from "./TimeChip.vue";
import { dayMonth, todayInZone } from "../lib/dates";
import { convertAmount, distinctUnits, parseAmount, servingName, unitsForFood, type CatalogFood, type OwnServing, type UnitChoice } from "../lib/foodAmount";
import { amountErrorIn, fromShown, isConverted, quickAmountsFor, readField, shownChoices, shownField, shownWeightWord, type ShownAmount } from "../lib/foodUnits";
import { int } from "../lib/format";
import type { MacroAmounts } from "../lib/macros";
import { scaleSource, valuesOf, type NutrientSource } from "../lib/nutrients";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../lib/foodSearch";
import { addNeedsTime, amountForRecent, logTimeForAdd } from "../lib/foodSheet";
import { bindPick, clickPick } from "../lib/cleanTap";
import { armReplace, primeKeyboard, selectField } from "../lib/focusField";
import { afterInsertion, markWholeSelection, nextQuickInput, nextQuickNumber, tookWholeSelection } from "../lib/quickEntry";
import { useFoodAmount } from "../lib/useFoodAmount";
import { keyboardEntry } from "../lib/viewport";
import {
  cleanRecipeName,
  finishedError,
  ingredientMacros,
  ingredientSource,
  perPortion,
  perPortionSentence,
  portionGrams,
  portionNutrients,
  portionsError,
  presetFromLogged,
  recipeLogFactor,
  recipeLogProblem,
  recipeMacro,
  recipeNameError,
  recipeNameMax,
  recipeServingLine,
  recipeTotalLine,
  scaleRecipeLog,
  scaleStoredLine,
  scaleStoredSource,
  selectionSkipNote,
  sumTotals,
  type RecipeLogInput,
  type RecipeTotals,
} from "../lib/recipes";
import { afterTitle, entriesOn, targetOn } from "../state/foodDay";
import { deviceTimeZone, profile } from "../state/profile";
import { foodAmount, foodUnit } from "../state/units";
import { findEntry, totalsOf, viewed } from "../state/log";
import { deleteRecipeWithUndo, fetchRecipe, logSavedRecipe, saveRecipe } from "../state/recipes";
import { closeRecipeSheet, finishRecipeSave, openRecipeEdit, toast, ui } from "../ui";

interface DraftLine {
  key: string;
  foodId: string;
  name: string;
  amountText: string;
  unit: string;
  available: boolean;
  food: CatalogFood | null;
  /** A saved line's amount, macros and panel, for an ingredient whose food is gone or not loaded yet. */
  stored: (RecipeTotals & NutrientSource & { amount: number; unit: string }) | null;
  /** The saved amount the field was filled from, so an untouched field saves it exactly. */
  origin: ShownAmount | null;
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
const finishedOrigin = ref<ShownAmount | null>(null);
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
/** Adding an ingredient: the same amount screen as logging a food. */
const pickError = ref("");
const pickOffline = ref(false);
// Its first quick amount is what this person logged last time, as in Add food.
const ingredient = useFoodAmount({
  formError: pickError,
  saveError: pickOffline,
  onServings: applyServings,
  lastLogged: (foodId) => recents.value.find((row) => row.id === foodId) ?? null,
});
const logAmount = ref("1");
const logUnit = ref<"portion" | "g">("portion");
const logOrigin = ref<ShownAmount | null>(null);
const time = ref<string | null>(null);
const logKey = ref("");
const snapshot = ref<RecipeLogInput | null>(null);
/** The saved recipe's panel past the macros, for the log card's nutrient pages. */
const recipePanel = ref<NutrientSource>({});
const recents = ref<RecentFood[]>([]);
/** Set by a Save tap that could not save yet, so every field says what it still needs. */
const tried = ref(false);
let searchGen = 0;
let searchTimer = 0;

const foodToday = computed(() => viewed.today || todayInZone(deviceTimeZone()));
/** Any day but today, earlier or planned, needs a picked time, never now. */
const otherDay = computed(() => ui.foodDate !== foodToday.value);
const needTime = computed(() => addNeedsTime(ui.foodDate, foodToday.value, time.value, false));
const portions = computed(() => parseAmount(portionsText.value));
/**
 * Amounts in this sheet are typed in the shown food unit (ounces with Food set to oz) and saved in grams.
 * `fill` puts a saved amount in a field and remembers it; `metric` reads a field for the API, giving back
 * the saved amount while the field is untouched (150 g shows as 5.3 oz, which would save 150.25 g).
 */
function fill(amount: number | string, unit: string): ShownAmount {
  return shownField(String(amount), unit, foodUnit());
}
function metric(text: string, unit: string, origin: ShownAmount | null): number {
  return readField(text, unit, foodUnit(), origin);
}
function fillFinished(grams: number | null) {
  finishedOrigin.value = grams == null ? null : fill(grams, "g");
  finishedText.value = finishedOrigin.value?.text ?? "";
}
/** Also used by the amount chips, which carry the amount in portions or grams. */
function fillLog(amount: number | string, unit: "portion" | "g") {
  logOrigin.value = fill(amount, unit);
  logAmount.value = logOrigin.value.text;
}
const weightWord = computed(() => shownWeightWord("g", foodUnit()));
const weightName = computed(() => (foodUnit() === "oz" ? "ounces" : "grams"));

const finished = computed(() => (finishedText.value.trim() ? metric(finishedText.value, "g", finishedOrigin.value) : null));
const nameProblem = computed(() => recipeNameError(name.value));
const portionsProblem = computed(() => (portionsText.value.trim() ? portionsError(portions.value) : "Enter portions above 0 and at most 1,000."));
const finishedProblem = computed(() => finishedError(finished.value, foodUnit()));

function macrosOf(line: DraftLine): RecipeTotals | null {
  const amount = metric(line.amountText, line.unit, line.origin);
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

/** The rest of a line's panel, scaled the same way as `macrosOf`. */
function sourceOf(line: DraftLine): NutrientSource | null {
  const amount = metric(line.amountText, line.unit, line.origin);
  if (line.food) return ingredientSource(line.food, amount, line.unit);
  if (line.stored && line.unit === line.stored.unit) return scaleStoredSource(line.stored, amount);
  return null;
}
const lineSources = computed(() => lines.value.map((line) => sourceOf(line)).filter((row): row is NutrientSource => row !== null));
const zero: MacroAmounts = { kcal: 0, p: 0, f: 0, c: 0 };
/** The editor's card: one portion against the daily targets. Zero until portions and every amount can be used. */
const perAmounts = computed<MacroAmounts>(() => (per.value ? { kcal: per.value.kcal, p: per.value.protein, f: per.value.fat, c: per.value.carbs } : zero));
const perValues = computed(() => (per.value ? portionNutrients(lineSources.value, portions.value) : {}));
const totalLine = computed(() => (linesOk.value ? recipeTotalLine(total.value) : "Fix the amount marked below."));
const formReady = computed(() =>
  !nameProblem.value
  && !portionsProblem.value
  && !finishedProblem.value
  && lines.value.length > 0
  && lineMacros.value.every((row) => row !== null));

/** Recipe form: Save sits in the header and the totals sit under it, so neither covers the fields. */
const showForm = computed(() => !loading.value && mode.value !== "log" && step.value === "form");

const logPreview = computed(() => (
  snapshot.value ? scaleRecipeLog(snapshot.value, metric(logAmount.value, logUnit.value, logOrigin.value), logUnit.value) : null
));
const logProblem = computed(() => (snapshot.value ? recipeLogProblem(snapshot.value, metric(logAmount.value, logUnit.value, logOrigin.value), logUnit.value, foodUnit()) : null));
const eachPortion = computed(() => (snapshot.value ? portionGrams(snapshot.value) : null));
/** Log card: the day's totals with this amount added, as on Add food. */
const logGoal = computed(() => targetOn(ui.foodDate, foodToday.value));
const logTitle = computed(() => afterTitle(ui.foodDate, foodToday.value, "adding", Boolean(logGoal.value)));
const logAdding = computed<MacroAmounts>(() => {
  const preview = logPreview.value;
  return preview ? { kcal: preview.kcal, p: preview.protein, f: preview.fat, c: preview.carbs } : zero;
});
const logAfter = computed<MacroAmounts>(() => {
  const day = totalsOf(entriesOn(ui.foodDate, foodToday.value));
  return { kcal: day.kcal + logAdding.value.kcal, p: day.p + logAdding.value.p, f: day.f + logAdding.value.f, c: day.c + logAdding.value.c };
});
const logSource = computed<NutrientSource>(() => {
  const factor = snapshot.value ? recipeLogFactor(snapshot.value, metric(logAmount.value, logUnit.value, logOrigin.value), logUnit.value) : null;
  return scaleSource(recipePanel.value, factor ?? 0);
});
const logValues = computed(() => valuesOf(logSource.value));
const servingLine = computed(() => (snapshot.value ? recipeServingLine(snapshot.value) : ""));
const logUnits = computed<AmountUnit[]>(() => (snapshot.value?.finishedGrams
  ? [
    { id: "portion", label: "portion", on: logUnit.value === "portion" },
    { id: "g", label: weightName.value, on: logUnit.value === "g" },
  ]
  : []));
const eachPortionText = computed(() => (eachPortion.value == null ? "" : foodUnit() === "oz" ? foodAmount(eachPortion.value, "g") : `${int(eachPortion.value)} g`));
/** Chip amounts in portions or grams; with Food set to oz the gram chips are 2, 4 and 8 oz. The last is the whole recipe. */
const logChips = computed(() => {
  if (logUnit.value === "portion") return [0.5, 1, 2];
  const chips = quickAmountsFor("g", foodUnit()).map((value) => fromShown(value, "g", foodUnit()));
  const full = finished.value;
  const whole = full != null && full > 0 && full <= 10000 ? full : null;
  if (whole != null && !chips.some((grams) => foodAmount(grams, "g") === foodAmount(whole, "g"))) chips.push(whole);
  return chips;
});
const logChipRows = computed<AmountChip[]>(() => logChips.value.map((amount) => ({ id: String(amount), label: foodAmount(amount, logUnit.value) })));

// Edit on Log recipe swaps the mode while the sheet stays open, so that starts over too.
watch(() => [open.value, ui.recipeMode, ui.recipeId] as const, ([isOpen]) => {
  if (!isOpen) return;
  void reset();
});

async function reset() {
  step.value = "form";
  name.value = "";
  // A recipe always has portions: a new one starts at 1.
  portionsText.value = "1";
  fillFinished(null);
  lines.value = [];
  notice.value = "";
  error.value = "";
  saving.value = false;
  loading.value = false;
  loadedName.value = "";
  recipeId.value = ui.recipeId;
  q.value = "";
  results.value = [];
  ingredient.food.value = null;
  fillLog(1, "portion");
  logUnit.value = "portion";
  time.value = null;
  logKey.value = "";
  snapshot.value = null;
  recipePanel.value = {};
  padTarget.value = null;
  tried.value = false;
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

function fillRecipe(recipe: Recipe) {
  loadedName.value = recipe.name;
  snapshot.value = {
    portions: recipe.portions,
    finishedGrams: recipe.finishedGrams,
    kcal: recipe.kcal,
    protein: recipe.protein,
    fat: recipe.fat,
    carbs: recipe.carbs,
  };
  recipePanel.value = panelOf(recipe);
  name.value = recipe.name;
  portionsText.value = String(recipe.portions);
  fillFinished(recipe.finishedGrams);
  notice.value = recipe.notice;
  lines.value = recipe.ingredients.map((item) => {
    const origin = fill(item.amount, item.unit);
    return {
      key: item.id,
      foodId: item.foodId,
      name: item.name,
      amountText: origin.text,
      unit: item.unit,
      available: item.available,
      food: null,
      stored: {
        ...panelOf(item),
        amount: item.amount,
        unit: item.unit,
        kcal: item.kcal,
        protein: item.protein,
        fat: item.fat,
        carbs: item.carbs,
      },
      origin,
    };
  });
  if (mode.value === "log") {
    portionsText.value = String(recipe.portions);
    fillFinished(recipe.finishedGrams);
  }
}

function panelOf(row: Recipe | RecipeIngredient): NutrientSource {
  return { fat: row.fat, saturatedFat: row.saturatedFat, sugars: row.sugars, fiber: row.fiber, salt: row.salt, nutrients: row.nutrients };
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
      lines.value.push(draftFrom(food, fill(preset.amount, preset.unit)));
    } catch {
      leftOut.push(entry.name);
    }
  }
  if (leftOut.length) {
    const extra = `${leftOut.join(", ")} is no longer available and was left out.`;
    notice.value = notice.value ? `${notice.value} ${extra}` : extra;
  }
}

/** A new line showing `origin`, an amount in grams (or a count) put in the shown unit. */
function draftFrom(food: CatalogFood, origin: ShownAmount): DraftLine {
  return {
    key: crypto.randomUUID(),
    foodId: food.id,
    name: food.name,
    amountText: origin.text,
    unit: origin.unit,
    available: true,
    food,
    stored: null,
    origin,
  };
}

function lineSummary(line: DraftLine): string {
  const macros = macrosOf(line);
  if (!macros) return "";
  return `${int(macros.kcal)} kcal · P ${recipeMacro(macros.protein)}`;
}

/** Unit chips show under the ingredient being edited, or one whose unit can't be used. */
function showUnits(line: DraftLine): boolean {
  return unitChoices(line).length > 1 && (padLine.value === line.key || macrosOf(line) === null);
}

function lineError(line: DraftLine): string | null {
  if (macrosOf(line)) return null;
  if (!line.available) return "That food is no longer available. Keep the saved unit.";
  return amountErrorIn(metric(line.amountText, line.unit, line.origin), line.unit, foodUnit()) ?? "Choose a unit this food can be logged in.";
}

function unitChoices(line: DraftLine): UnitChoice[] {
  return line.food ? shownChoices(distinctUnits(unitsForFood(line.food), line.unit), foodUnit()) : [];
}

/** Word next to the amount: the chip's name ("porsjon", "stk"), not the API value ("serving", "piece"). */
function unitWord(unit: string, choices: readonly UnitChoice[]): string {
  if (isConverted(unit, foodUnit())) return shownWeightWord(unit, foodUnit());
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
  line.origin = fill(convertAmount(metric(line.amountText, line.unit, line.origin), current, next, true), next.unit);
  line.amountText = line.origin.text;
  line.unit = next.unit;
}

/** Same food, same size: one portion is finished weight ÷ portions. */
function setLogUnit(next: "portion" | "g") {
  if (next === logUnit.value) return;
  const each = eachPortion.value;
  if (each != null) {
    const portion: UnitChoice = { unit: "portion", label: "portion", gramsEach: each };
    const gram: UnitChoice = { unit: "g", label: "g", gramsEach: 1 };
    const amount = metric(logAmount.value, logUnit.value, logOrigin.value);
    fillLog(next === "g" ? convertAmount(amount, portion, gram) : convertAmount(amount, gram, portion), next);
  }
  logUnit.value = next;
}

/**
 * Keep the focused field in view. For an ingredient amount that is the whole ingredient,
 * so its unit chips are not left under the keypad. Two frames: the keypad and the chips
 * mount on the same focus, and the scroll has to wait for that layout.
 */
function reveal(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const box = target.closest<HTMLElement>(".ing") ?? target;
  requestAnimationFrame(() => requestAnimationFrame(() => box.scrollIntoView({ block: "nearest" })));
}

function selectAmount(event: FocusEvent) {
  if (event.target instanceof HTMLInputElement) selectField(event.target);
}

const padReplace = ref(false);
const padTarget = ref<"log" | "portions" | "finished" | "line" | null>(null);
const padLine = ref<string | null>(null);

function readPad(): string {
  if (padTarget.value === "log") return logAmount.value;
  if (padTarget.value === "portions") return portionsText.value;
  if (padTarget.value === "finished") return finishedText.value;
  if (padTarget.value === "line") return lines.value.find((line) => line.key === padLine.value)?.amountText ?? "";
  return "";
}

function writePad(next: string) {
  if (padTarget.value === "log") logAmount.value = next;
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
  if (padTarget.value === "finished") return `Finished weight: ${finishedText.value || "–"} ${weightWord.value}`;
  if (padTarget.value === "line") {
    const line = lines.value.find((item) => item.key === padLine.value);
    // The card is scrolled away while an ingredient is typed in, so its figures come here.
    if (line && per.value) return `Per portion · ${recipeTotalLine(per.value)}`;
    if (line) return `${line.name}: ${line.amountText || "–"} ${unitWord(line.unit, unitChoices(line))}`;
  }
  return "";
});

function closePad() {
  padTarget.value = null;
  padLine.value = null;
}

/** Done also lets go of the field, so its ring and unit chips go away with the keypad. */
function donePad() {
  closePad();
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) active.blur();
}

function onPadFocus(target: "log" | "portions" | "finished" | "line", event: FocusEvent, lineKey?: string) {
  padTarget.value = target;
  padLine.value = lineKey ?? null;
  padReplace.value = true;
  if (event.target instanceof HTMLInputElement) armReplace(event.target);
}

/** The log screen's keypad types into its one field, focused or not. */
function onLogKey(key: string) {
  if (padTarget.value !== "log") {
    padTarget.value = "log";
    padReplace.value = false;
  }
  onPadKey(key);
}

function setLogChip(id: string) {
  fillLog(Number(id), logUnit.value);
}

function pickLogUnit(id: string) {
  setLogUnit(id === "g" ? "g" : "portion");
}

function editFromLog() {
  if (recipeId.value) openRecipeEdit(recipeId.value, "log");
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

/** Matvaretabellen is most results, so it is not named. The others are. */
function sourceLabel(source: string): string {
  if (source === "custom") return "Your food";
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
  if (food.servingQuantity != null && food.servingLabel) {
    const perHundred = food.nutrientBasis === "per_100" && (food.basis === "g" || food.basis === "ml");
    bits.push(perHundred ? `1 ${food.servingLabel} = ${int(food.servingQuantity)} ${food.basis}` : `${food.servingQuantity} ${food.servingLabel}`);
  }
  const source = food.source ? sourceLabel(food.source) : "";
  if (source) bits.push(source);
  return bits.join(" · ");
}

function backStep() {
  primeKeyboard();
  closePad();
  step.value = step.value === "amount" ? "search" : "form";
}

async function openSearch() {
  primeKeyboard();
  closePad();
  step.value = "search";
  q.value = "";
  results.value = [];
  error.value = "";
  const [own, recent] = await Promise.allSettled([listMyFoods(), listRecentFoods()]);
  mine.value = own.status === "fulfilled" ? own.value.foods : [];
  recents.value = recent.status === "fulfilled" ? recent.value.foods : [];
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
  if (searching.value || searchSections.value.some((section) => section.rows.length)) return "";
  const query = q.value.trim();
  if (query.length >= 2) return `No foods match “${query}”. Try fewer letters or another word.`;
  return query ? "Type at least 2 letters." : "Search for a food above. Foods you log show up here.";
});
/** Before a search: recent foods with their last amount, then this person's own foods. */
const searchSections = computed<{ title: string; rows: FoodSearchRow[] }[]>(() => {
  const query = q.value.trim();
  if (query.length >= 2) return [{ title: "", rows: results.value }];
  const needle = query.toLowerCase();
  const matches = (food: FoodSearchRow) => !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);
  const recent = recents.value.filter(matches);
  const seen = new Set(recent.map((food) => food.id));
  const own = mine.value.filter((food) => !seen.has(food.id) && matches(food));
  return [{ title: "Recent", rows: recent }, { title: "Your foods", rows: own }].filter((section) => section.rows.length);
});
function isRecentRow(food: FoodSearchRow): food is RecentFood {
  return q.value.trim().length < 2 && typeof (food as RecentFood).amount === "number" && typeof (food as RecentFood).unit === "string";
}
function rowFacts(food: FoodSearchRow): string {
  if (!isRecentRow(food)) return foodFacts(food);
  const last = amountForRecent(food, food.amount, food.unit);
  const macros = ingredientMacros(food, Number(last.amount), last.unit);
  return macros ? `Last ${foodAmount(Number(last.amount), last.unit)} · ${int(macros.kcal)} kcal · P ${recipeMacro(macros.protein)}` : foodFacts(food);
}

function pressIngredient(event: PointerEvent, food: FoodSearchRow) {
  bindPick(event, () => { void chooseFood(food); });
}
function pickIngredient(event: MouseEvent, food: FoodSearchRow) {
  clickPick(event, () => { void chooseFood(food); });
}
async function chooseFood(food: FoodSearchRow) {
  primeKeyboard();
  const last = isRecentRow(food) ? { amount: food.amount, unit: food.unit } : null;
  let current: CatalogFood = food;
  try {
    current = { ...food, ...(await getFood(food.id)) };
  } catch {
    current = food;
  }
  if (!open.value) return;
  ingredient.show(current, last ?? undefined);
  pickError.value = "";
  pickOffline.value = false;
  step.value = "amount";
}

/** A serving saved on the amount screen also shows on this food in the lists. */
function applyServings(foodId: string, servings: OwnServing[]) {
  const next = <T extends { id: string }>(food: T): T => (food.id === foodId ? { ...food, servings } : food);
  results.value = results.value.map(next);
  recents.value = recents.value.map(next);
  mine.value = mine.value.map(next);
}

function addPicked() {
  const food = ingredient.food.value;
  if (!food || lines.value.length >= 100) return;
  const amount = ingredient.amountNumber.value;
  const unit = ingredient.unit.value;
  const problem = amountErrorIn(amount, unit, foodUnit()) ?? (ingredientMacros(food, amount, unit) ? null : "Choose a unit for this food.");
  if (problem) {
    pickError.value = problem;
    return;
  }
  lines.value.push(draftFrom(food, fill(amount, unit)));
  ingredient.food.value = null;
  closePad();
  step.value = "form";
}

function removeLine(key: string) {
  if (padLine.value === key) closePad();
  lines.value = lines.value.filter((line) => line.key !== key);
}

async function save() {
  if (saving.value) return;
  // Save stays tappable: a tap that can't save yet makes each field say what it needs.
  if (!formReady.value) {
    tried.value = true;
    return;
  }
  saving.value = true;
  error.value = "";
  const result = await saveRecipe({
    name: cleanRecipeName(name.value),
    portions: portions.value,
    finishedGrams: finished.value,
    ingredients: lines.value.map((line) => ({
      foodId: line.foodId,
      amount: metric(line.amountText, line.unit, line.origin),
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
  const where = ui.recipeReturn === "food" || ui.recipeReturn === "log" ? "" : " Find it under Add food → Recipes.";
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
  // Opened from Log recipe: that recipe is gone, so close back to the list.
  if (ui.recipeReturn === "log") ui.recipeReturn = "food";
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
    amount: metric(logAmount.value, logUnit.value, logOrigin.value),
    unit: logUnit.value,
  });
  saving.value = false;
  if (!result.ok) {
    logKey.value = "";
    error.value = result.message;
    return;
  }
  toast(`Added ${foodAmount(result.entry.amount, result.entry.unit)} ${result.entry.name} · ${recipeMacro(result.entry.protein)} g protein`);
  closeRecipeSheet();
}

</script>

<template>
  <BottomSheet :open="open" :label="title" full @close="closeRecipeSheet">
    <template #header>
      <div class="hwrap">
        <div class="row hdr">
          <button v-if="step !== 'form'" type="button" class="cbtn" aria-label="Back" @click="backStep">
            <Icon name="left" :size="18" />
          </button>
          <!-- The amount screens name the food or recipe in their body, as when logging a food. -->
          <span v-if="step === 'amount' || mode === 'log'" class="grow" />
          <h2 v-else class="t-head grow htitle">{{ step === "search" ? "Add ingredient" : title }}</h2>
          <TimeChip v-if="mode === 'log' && step === 'form'" v-model="time" :date="ui.foodDate" :today="foodToday" />
          <button
            v-if="showForm"
            type="button"
            class="btn sm primary t-label savebtn"
            :aria-disabled="!formReady || saving"
            aria-label="Save recipe"
            data-recipe-save
            @click="save"
          >{{ saving ? "Saving…" : "Save" }}</button>
          <button type="button" class="cbtn" aria-label="Close" @click="closeRecipeSheet">
            <Icon name="x" :size="18" />
          </button>
        </div>
        <p v-if="showForm && error" class="t-label err" role="alert">{{ error }}</p>
      </div>
    </template>

    <p v-if="loading" class="t-label c2" role="status">Loading…</p>

    <AmountScreen
      v-else-if="mode === 'log'"
      :title="loadedName"
      :amount-text="logAmount"
      field-label="Amount to log"
      :unit-word="logUnit === 'g' ? weightWord : 'portion'"
      :units="logUnits"
      units-label="Log by"
      :chips="logChipRows"
      data-recipe-log
      @focus="onPadFocus('log', $event)"
      @input="onPadInput"
      @submit="addLog"
      @unit="pickLogUnit"
      @chip="setLogChip"
      @key="onLogKey"
    >
      <template #meta>
        <span class="tag t-capn">recipe</span>
        <span class="serving" data-recipe-serving>{{ servingLine }}</span>
        <button v-if="snapshot" type="button" class="btn sm secondary t-label" aria-label="Edit recipe" @click="editFromLog"><Icon name="edit" :size="14" /> Edit</button>
      </template>
      <template #notice>
        <p v-if="needTime" class="t-label need" role="status">Logging to {{ dayMonth(ui.foodDate) }} — pick the time you ate it.</p>
      </template>
      <template #subline>
        <span v-if="eachPortion" data-recipe-each>1 portion = {{ eachPortionText }}</span>
      </template>
      <template #card>
        <NutrientCard :title="logTitle" :goal="logGoal" :eaten="logAfter" :adding="logAdding" :values="logValues" :entries="[logSource]" :carbs="logAdding.c" portion label="Recipe nutrients" />
      </template>
      <template #alerts>
        <p v-if="!logPreview && logProblem" class="t-label err" role="status">{{ logProblem }}</p>
        <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
      </template>
      <template #hint><kbd>Enter</kbd> add · <kbd>Esc</kbd> close</template>
      <template #note><p class="t-label c3 lognote">Later edits to the recipe don't change this entry.</p></template>
      <template #actions>
        <button type="button" class="btn primary block t-bodys grow" :disabled="saving || !logPreview || needTime" @click="addLog">
          {{ saving ? "Adding…" : needTime ? "Pick a time to add" : logPreview ? `Add · ${int(logPreview.kcal)} kcal` : "Add" }}
        </button>
      </template>
    </AmountScreen>

    <div v-else-if="step === 'search'" class="stack search">
      <label class="field row finder">
        <Icon name="search" :size="18" class="c2" />
        <input v-autofocus v-model="q" class="t-body grow" type="search" placeholder="Search foods" aria-label="Search foods" autocomplete="off" enterkeyhint="search" />
      </label>
      <p v-if="searching" class="t-label c2" role="status">Searching…</p>
      <section v-for="section in searchSections" :key="section.title" class="col">
        <h3 v-if="section.title" class="t-cap c3 section-title">{{ section.title }}</h3>
        <button v-for="food in section.rows" :key="food.id" type="button" class="rrow row" @pointerdown="pressIngredient($event, food)" @click="pickIngredient($event, food)">
          <span class="col grow rtext">
            <span class="t-body name">{{ food.name }}</span>
            <span class="t-label c2 facts">{{ rowFacts(food) }}</span>
          </span>
          <MicroRing :nutrients="food.nutrients" />
        </button>
      </section>
      <p v-if="searchEmpty" class="t-label c2" role="status">{{ searchEmpty }}</p>
    </div>

    <FoodAmountView v-else-if="step === 'amount' && ingredient.food.value" :amount="ingredient" macro-title="This ingredient" @submit="addPicked">
      <template #meta>
        <span v-if="ingredient.food.value.brand">{{ ingredient.food.value.brand }} ·</span>
      </template>
      <template #alerts>
        <p v-if="pickError" class="t-label err" role="alert">{{ pickError }}</p>
        <p v-if="pickOffline" class="t-label err" role="alert">Server unreachable. Try again in a moment.</p>
      </template>
      <template #hint><kbd>Enter</kbd> add to recipe · <kbd>Esc</kbd> close</template>
      <template #actions>
        <button type="button" class="btn primary block t-bodys grow" @click="addPicked">Add to recipe · {{ int(ingredient.preview.value.kcal) }} kcal</button>
      </template>
    </FoodAmountView>

    <div v-else class="stack" @focusin="reveal">
      <p v-if="notice" class="t-label note" role="status">{{ notice }}</p>
      <!-- Scrolls with the form: pinned, it would leave the keypad room for one ingredient. -->
      <div class="pcard" data-recipe-card>
        <NutrientCard title="Per portion" :goal="profile.targets" :eaten="perAmounts" :tags="false" :values="perValues" :entries="lineSources" :carbs="perAmounts.c" portion label="Nutrients per portion" />
      </div>
      <p class="sr-only" aria-live="polite" data-recipe-portion>{{ per ? `${sentence} · ${recipeMacro(per.fat)} g fat · ${recipeMacro(per.carbs)} g carbs · ${int(per.kcal)} kcal` : "" }}</p>
      <label class="field row">
        <span class="t-label c2">Name</span>
        <input v-model="name" data-no-autofocus class="t-body grow" type="text" placeholder="Weeknight stew" :maxlength="recipeNameMax" autocomplete="off" aria-label="Recipe name" @focus="onNameFocus" />
      </label>
      <div class="two">
        <label class="field row">
          <span class="t-label c2">Portions</span>
          <input :value="portionsText" data-no-autofocus data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" aria-label="Portions" placeholder="e.g. 4" @focus="onPadFocus('portions', $event)" @beforeinput="markWholeSelection" @input="onPadInput" />
        </label>
        <label class="field row">
          <span class="t-label c2">Finished ({{ weightWord }})</span>
          <input :value="finishedText" data-no-autofocus data-replace="1" class="t-body grow num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Finished weight in ${weightName}, optional`" placeholder="Optional" @focus="onPadFocus('finished', $event)" @beforeinput="markWholeSelection" @input="onPadInput" />
        </label>
      </div>
      <p v-if="nameProblem && (name.trim() || tried)" class="t-label err" role="status">{{ nameProblem }}</p>
      <p v-if="(portionsText.trim() || tried) && portionsProblem" class="t-label err" role="status">{{ portionsProblem }}</p>
      <p v-if="finishedProblem" class="t-label err" role="status">{{ finishedProblem }}</p>
      <div class="row sec">
        <span class="t-cap c3 section-title">Ingredients</span>
        <span v-if="lines.length" class="t-cap c3 total" data-recipe-total>{{ totalLine }}</span>
      </div>
      <p v-if="!lines.length" class="t-label" :class="tried ? 'err' : 'c2'">Add a food. The card at the top updates as you go.</p>
      <div v-else class="items col">
        <div v-for="(line, index) in lines" :key="line.key" class="ing" :data-ingredient-index="index">
          <div class="ingrow">
            <span class="ingtext">
              <span class="t-body name" :title="line.name">{{ line.name }}</span>
              <span v-if="lineSummary(line)" class="t-label c2">{{ lineSummary(line) }}</span>
              <span v-else class="t-label err" role="status">{{ lineError(line) }}</span>
            </span>
            <label class="amt" :class="{ on: padLine === line.key }">
              <input :value="line.amountText" data-no-autofocus data-replace="1" class="t-body num" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Amount of ${line.name}`" :readonly="!line.available && !line.stored" @focus="onPadFocus('line', $event, line.key)" @beforeinput="markWholeSelection" @input="onPadInput" />
              <span class="t-label c2">{{ unitWord(line.unit, unitChoices(line)) }}</span>
            </label>
            <button type="button" class="cbtn" :aria-label="`Remove ${line.name}`" @click="removeLine(line.key)">
              <Icon name="x" :size="16" />
            </button>
          </div>
          <p v-if="!line.available" class="t-label c2 gone">No longer available. Saved totals stay until you remove it.</p>
          <div v-if="showUnits(line)" class="row units" role="radiogroup" :aria-label="`Unit for ${line.name}`" @mousedown.prevent>
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
      <button type="button" class="field add-btn t-body" @click="openSearch">
        <Icon name="search" :size="16" /> Add ingredient
      </button>
      <button v-if="mode === 'edit'" type="button" class="btn sm secondary t-label gdel" :disabled="saving" @click="removeRecipe">
        <Icon name="trash" :size="14" /> Delete recipe
      </button>
    </div>

    <template v-if="showForm && !keyboardEntry && padTarget" #footer>
      <div class="padwrap" data-recipe-pad @mousedown.prevent>
        <div class="row padhead">
          <span class="t-label c2 grow padcap" aria-live="polite">{{ padCaption }}</span>
          <button type="button" class="btn sm primary t-label" @click="donePad">Done</button>
        </div>
        <Keypad @key="onPadKey" />
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.hwrap { display: flex; flex-direction: column; gap: var(--space-s); min-width: 0; }
.hdr { gap: var(--space-s); min-width: 0; align-items: center; }
.htitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stack { display: flex; flex-direction: column; gap: var(--space-m); }
.field { flex: none; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-s); }
.two .field { min-width: 0; }
.two input { min-width: 0; width: 100%; }
.two .t-label { flex: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.finder { position: sticky; top: 0; z-index: 1; }
/* The same box as the amount screens' card. */
.pcard { display: flex; flex-direction: column; height: var(--nutrient-card-height); padding: var(--space-box) var(--space-box) 0; border-radius: var(--radius-l); background: var(--color-surface-2); flex: none; box-sizing: border-box; }
/* The total sits at the right of the heading, and goes under it when there's no room. */
.sec { align-items: baseline; flex-wrap: wrap; column-gap: var(--space-m); row-gap: var(--space-2xs); margin-top: var(--space-s); }
.sec .section-title { margin: 0; }
.sec .total { margin-left: auto; }
.serving { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
html.dt-xl .serving { overflow: visible; text-overflow: clip; white-space: normal; }
.items { gap: 0; }
.ing { display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-2xs) 0; border-bottom: 1px solid var(--color-border); }
.ingrow { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; gap: var(--space-s); align-items: center; min-height: 52px; }
.ingtext { display: flex; flex-direction: column; min-width: 0; }
.ingtext .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amt { display: flex; align-items: center; gap: var(--space-xs); min-height: 40px; padding: 0 var(--space-m); border-radius: var(--radius-m); background: var(--color-surface-2); }
.amt input { width: 3.6rem; min-height: 40px; border: 0; outline: 0; background: transparent; padding: 0; color: var(--text-primary); }
.amt input:focus-visible { outline: 0; }
.amt.on, .amt:focus-within { box-shadow: inset 0 0 0 2px var(--text-primary); }
.ing .units { padding-bottom: var(--space-s); }
.gone { margin: 0; }
.units, .chips { gap: var(--space-s); flex-wrap: wrap; }
.rrow { min-height: 56px; width: 100%; gap: var(--space-s); padding: var(--space-s) 0; border: 0; border-bottom: 1px solid var(--color-border); background: transparent; text-align: left; }
.rtext { gap: var(--space-2xs); min-width: 0; align-items: flex-start; }
.name, .facts { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.section-title { margin: var(--space-s) 0 0; }
.padwrap { display: flex; flex-direction: column; gap: var(--space-s); }
.padhead { align-items: center; gap: var(--space-s); min-width: 0; }
.padcap { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lognote { margin: 0; text-align: center; }
.err, .note, .need { margin: 0; }
.add-btn { width: 100%; color: var(--text-secondary); text-align: left; }
.gdel { align-self: flex-start; margin-top: var(--space-s); }
</style>
