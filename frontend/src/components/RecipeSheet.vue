<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { getFood, listMyFoods, searchFoods, type FoodSearchRow, type RecipeIngredient } from "../api";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import TimeChip from "./TimeChip.vue";
import { dayMonth, todayInZone } from "../lib/dates";
import { amountError, amountLabel, defaultAmount, parseAmount, unitsForFood, type CatalogFood } from "../lib/foodAmount";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../lib/foodSearch";
import { addNeedsTime, logTimeForAdd } from "../lib/foodSheet";
import {
  cleanRecipeName,
  finishedError,
  ingredientMacros,
  perPortion,
  perPortionSentence,
  portionsError,
  presetFromLogged,
  recipeFigure,
  recipeFinishedMax,
  recipeNameError,
  recipeNameMax,
  scaleRecipeLog,
  scaleStoredLine,
  selectionSkipNote,
  sumTotals,
  type RecipeLogInput,
  type RecipeTotals,
} from "../lib/recipes";
import { keyboardEntry } from "../lib/viewport";
import { deviceTimeZone } from "../state/profile";
import { findEntry, viewed } from "../state/log";
import { fetchRecipe, logSavedRecipe, retireRecipe, saveRecipe } from "../state/recipes";
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
const nameEl = ref<HTMLInputElement | null>(null);
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
const total = computed(() => sumTotals(lineMacros.value.filter((row): row is RecipeTotals => row !== null)));
const per = computed(() => (portionsProblem.value ? null : perPortion(total.value, portions.value)));
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
  if (keyboardEntry.value && mode.value !== "log") nextTick(() => nameEl.value?.focus());
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
  return `${recipeFigure(macros.protein)} g protein · ${recipeFigure(macros.kcal)} kcal`;
}

function lineError(line: DraftLine): string | null {
  if (macrosOf(line)) return null;
  if (!line.available) return "That food is no longer available. Keep the saved unit.";
  return amountError(parseAmount(line.amountText), line.unit) ?? "Choose a unit this food can be logged in.";
}

async function openSearch() {
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

const searchRows = computed(() => (q.value.trim().length >= 2 ? results.value : mine.value.filter((food) => {
  const needle = q.value.trim().toLowerCase();
  return !needle || `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(needle);
})));

async function chooseFood(food: FoodSearchRow) {
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
  step.value = "form";
}

function removeLine(key: string) {
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
  toast(`${verb} “${result.recipe.name}” · ${recipeFigure(result.recipe.perPortion.protein)} g protein per portion. Find it under Add food → Recipes.`);
  finishRecipeSave();
}

async function removeRecipe() {
  if (saving.value || !recipeId.value) return;
  saving.value = true;
  const removed = await retireRecipe(recipeId.value);
  saving.value = false;
  if (!removed) {
    error.value = "Couldn't delete that recipe.";
    return;
  }
  toast(`Deleted ${loadedName.value || name.value} · past logs kept`);
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
  toast(`Added ${amountLabel(result.entry.amount, result.entry.unit)} ${result.entry.name} · ${recipeFigure(result.entry.protein)} g protein`);
  closeRecipeSheet();
}

</script>

<template>
  <BottomSheet :open="open" :label="title" full @close="closeRecipeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="step !== 'form'" type="button" class="cbtn" style="--s: 44px" aria-label="Back" @click="step = step === 'amount' ? 'search' : 'form'">
          <Icon name="left" :size="18" />
        </button>
        <h2 class="t-head grow">{{ step === "search" ? "Add ingredient" : step === "amount" ? (picked?.name || "Amount") : title }}</h2>
        <TimeChip v-if="mode === 'log' && step === 'form'" v-model="time" :date="ui.foodDate" :today="foodToday" />
        <button type="button" class="cbtn" style="--s: 44px" aria-label="Close" @click="closeRecipeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
    </template>

    <p v-if="loading" class="t-label c2" role="status">Loading…</p>

    <template v-else-if="mode === 'log'">
      <p v-if="needTime" class="t-label need" role="status">Logging to {{ dayMonth(ui.foodDate) }} — pick the time you ate it.</p>
      <p class="t-label c2">The logged entry keeps these numbers. Later edits to the recipe do not change it.</p>
      <div class="preview" aria-live="polite">
        <div class="col center">
          <span class="t-nm">{{ logPreview ? recipeFigure(logPreview.kcal) : "–" }}</span>
          <span class="t-cap">kcal</span>
        </div>
        <div class="col center">
          <span class="t-nm">{{ logPreview ? recipeFigure(logPreview.protein) : "–" }}</span>
          <span class="t-cap">protein</span>
        </div>
        <div class="col center">
          <span class="t-nm">{{ logPreview ? recipeFigure(logPreview.fat) : "–" }}</span>
          <span class="t-cap">fat</span>
        </div>
        <div class="col center">
          <span class="t-nm">{{ logPreview ? recipeFigure(logPreview.carbs) : "–" }}</span>
          <span class="t-cap">carbs</span>
        </div>
      </div>
      <label class="field row">
        <span class="t-label c2">Amount</span>
        <input v-model="logAmount" class="t-body grow num" inputmode="decimal" autocomplete="off" aria-label="Amount to log" />
      </label>
      <div class="row units" role="radiogroup" aria-label="Log by">
        <button type="button" class="chip t-label" role="radio" :class="{ on: logUnit === 'portion' }" :aria-checked="logUnit === 'portion'" @click="logUnit = 'portion'">portion</button>
        <button v-if="snapshot?.finishedGrams" type="button" class="chip t-label" role="radio" :class="{ on: logUnit === 'g' }" :aria-checked="logUnit === 'g'" @click="logUnit = 'g'">grams</button>
      </div>
      <div class="row chips">
        <button v-for="amount in logChips" :key="amount" type="button" class="chip t-label" @click="logAmount = String(amount)">{{ amountLabel(amount, logUnit === "g" ? "g" : "portion") }}</button>
      </div>
      <p v-if="logPreview" class="t-bodys">{{ recipeFigure(logPreview.protein) }} g protein in this log</p>
      <p v-else-if="logUnit === 'g'" class="t-label" role="status">This recipe has no finished weight, so it can't be logged in grams.</p>
      <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
      <button type="button" class="primary-btn t-bodys" :disabled="saving || !logPreview || needTime" @click="addLog">
        {{ saving ? "Adding…" : needTime ? "Pick a time to add" : `Add · ${logPreview ? recipeFigure(logPreview.kcal) : ""} kcal` }}
      </button>
    </template>

    <template v-else-if="step === 'search'">
      <label class="field row">
        <Icon name="search" :size="18" class="c2" />
        <input v-model="q" class="t-body grow" type="search" placeholder="Search foods" aria-label="Search foods" autocomplete="off" />
      </label>
      <p v-if="searching" class="t-label c2" role="status">Searching…</p>
      <div class="list">
        <button v-for="food in searchRows" :key="food.id" type="button" class="rrow row" @click="chooseFood(food)">
          <span class="col grow rtext">
            <span class="t-body ell">{{ food.name }}</span>
            <span class="t-label c2 ell">{{ food.brand || (food.nutrientBasis === "per_serving" ? "per serving" : `per 100 ${food.basis === "ml" ? "ml" : "g"}`) }}</span>
          </span>
        </button>
        <p v-if="!searching && !searchRows.length" class="t-label c2">No foods to add yet.</p>
      </div>
    </template>

    <template v-else-if="step === 'amount' && picked">
      <label class="field row">
        <span class="t-label c2">Amount</span>
        <input v-model="pickAmount" class="t-body grow num" inputmode="decimal" autocomplete="off" :aria-label="`Amount of ${picked.name}`" />
      </label>
      <div class="row units" role="radiogroup" :aria-label="`Unit for ${picked.name}`">
        <button
          v-for="choice in unitsForFood(picked)"
          :key="choice.unit"
          type="button"
          class="chip t-label"
          role="radio"
          :class="{ on: pickUnit === choice.unit }"
          :aria-checked="pickUnit === choice.unit"
          @click="pickUnit = choice.unit"
        >{{ choice.label }}</button>
      </div>
      <p v-if="pickMacros" class="t-bodys" aria-live="polite">{{ recipeFigure(pickMacros.protein) }} g protein · {{ recipeFigure(pickMacros.kcal) }} kcal</p>
      <p v-else-if="pickProblem" class="t-label err" role="status">{{ pickProblem }}</p>
      <button type="button" class="primary-btn t-bodys" :disabled="!pickMacros" @click="addPicked">Add to recipe</button>
    </template>

    <template v-else>
      <label class="field row">
        <input ref="nameEl" v-model="name" class="t-body grow" type="text" placeholder="Name, e.g. Weeknight stew" :maxlength="recipeNameMax" autocomplete="off" aria-label="Recipe name" />
      </label>
      <label class="field row">
        <span class="t-label c2">Portions</span>
        <input v-model="portionsText" class="t-body grow num" inputmode="decimal" autocomplete="off" aria-label="Portions" placeholder="e.g. 5" />
      </label>
      <label class="field row">
        <span class="t-label c2">Finished weight</span>
        <input v-model="finishedText" class="t-body grow num" inputmode="decimal" autocomplete="off" aria-label="Finished weight in grams, optional" :placeholder="`Optional, up to ${recipeFinishedMax} g`" />
      </label>
      <p class="t-label c2">Calories and macros are worked out from the foods. They update as you change ingredients, amounts, or portions.</p>
      <div class="preview" aria-live="polite">
        <div class="col sums">
          <span class="t-cap">Total</span>
          <span class="t-bodys" data-recipe-total>{{ recipeFigure(total.protein) }} g protein · {{ recipeFigure(total.fat) }} g fat · {{ recipeFigure(total.carbs) }} g carbs · {{ recipeFigure(total.kcal) }} kcal</span>
        </div>
        <div class="col sums">
          <span class="t-cap">Per portion</span>
          <span v-if="per" class="t-bodys" data-recipe-portion>{{ sentence }} · {{ recipeFigure(per.fat) }} g fat · {{ recipeFigure(per.carbs) }} g carbs · {{ recipeFigure(per.kcal) }} kcal</span>
          <span v-else class="t-label c2">Enter portions to see the amount per portion.</span>
        </div>
      </div>
      <div class="items col">
        <div v-for="(line, index) in lines" :key="line.key" class="line col">
          <div class="row">
            <span class="t-body grow ell">{{ line.name }}</span>
            <button type="button" class="cbtn" style="--s: 44px" :aria-label="`Remove ${line.name}`" @click="removeLine(line.key)">
              <Icon name="x" :size="16" />
            </button>
          </div>
          <label class="field row">
            <span class="t-label c2">Amount</span>
            <input v-model="line.amountText" class="t-body grow num" inputmode="decimal" autocomplete="off" :aria-label="`Amount of ${line.name}`" :readonly="!line.available && !line.stored" />
          </label>
          <div v-if="line.food" class="row units" role="radiogroup" :aria-label="`Unit for ${line.name}`">
            <button
              v-for="choice in unitsForFood(line.food)"
              :key="choice.unit"
              type="button"
              class="chip t-label"
              role="radio"
              :class="{ on: line.unit === choice.unit }"
              :aria-checked="line.unit === choice.unit"
              @click="line.unit = choice.unit"
            >{{ choice.label }}</button>
          </div>
          <p v-else class="t-label c2">{{ line.amountText }} {{ line.unit }}<template v-if="!line.available"> · no longer available</template></p>
          <p v-if="lineSummary(line)" class="t-label c2">{{ lineSummary(line) }}</p>
          <p v-else class="t-label err" role="status">{{ lineError(line) }}</p>
        </div>
      </div>
      <button type="button" class="chip t-label addfood" @click="openSearch"><Icon name="plus" :size="14" :sw="2.4" /> Add ingredient</button>
      <p v-if="notice" class="t-label" role="status">{{ notice }}</p>
      <p v-if="nameProblem && name.trim()" class="t-label err" role="status">{{ nameProblem }}</p>
      <p v-if="portionsText.trim() && portionsProblem" class="t-label err" role="status">{{ portionsProblem }}</p>
      <p v-if="finishedProblem" class="t-label err" role="status">{{ finishedProblem }}</p>
      <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
      <button v-if="mode === 'edit'" type="button" class="t-label gdel" :disabled="saving" @click="removeRecipe">
        <Icon name="trash" :size="14" /> Delete recipe
      </button>
      <button type="button" class="primary-btn t-bodys" :disabled="saving || !formReady" @click="save">
        {{ saving ? "Saving…" : mode === "edit" ? "Save recipe" : "Save recipe" }}
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; min-width: 0; }
.field { min-height: 44px; padding: 0 12px; gap: 8px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; width: 100%; padding: 0; color: var(--text-primary); }
.field input::placeholder { color: var(--text-tertiary); }
.num { text-align: right; }
.preview { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: var(--radius-card); background: var(--color-surface-2); }
.preview .t-nm { font-variant-numeric: tabular-nums; }
.sums { gap: 2px; align-items: flex-start; }
.center { align-items: center; text-align: center; flex: 1; }
.items { gap: 8px; }
.line { gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--color-border); }
.units, .chips { gap: 8px; flex-wrap: wrap; }
.list { display: flex; flex-direction: column; min-height: 0; }
.rrow { min-height: 56px; width: 100%; gap: 8px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--color-border); background: transparent; text-align: left; }
.rtext { gap: 2px; min-width: 0; align-items: flex-start; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.err { margin: 0; }
.need { margin: 0; }
.addfood { align-self: flex-start; }
.gdel { align-self: flex-start; min-height: 44px; padding: 8px 0; display: inline-flex; align-items: center; gap: 6px; text-decoration: underline; text-underline-offset: 3px; background: transparent; color: var(--text-primary); }
</style>
