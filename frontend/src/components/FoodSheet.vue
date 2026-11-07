<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ApiError, getFood, searchFoods, ServerUnreachable, type FoodSearchRow } from "../api";
import BottomSheet from "./BottomSheet.vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import Segmented from "./Segmented.vue";
import TimeChip from "./TimeChip.vue";
import { todayIso } from "../lib/dates";
import { int } from "../lib/format";
import {
  amountError,
  amountLabel,
  defaultAmount,
  macrosForFood,
  normalizeUnit,
  parseAmount,
  macroFigure,
  per100Line,
  scaleStored,
  unitsForEntry,
  unitsForFood,
  type UnitChoice,
} from "../lib/foodAmount";
import { acceptSearchResult, preparedSearch, searchDebounceMs } from "../lib/foodSearch";
import { kcalFromMacros, macroStatus } from "../lib/macros";
import { nextQuickInput, nextQuickNumber } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";
import { deviceTimeZone, profile } from "../state/profile";
import { dayTotals, log, removeEntry, saveQuickAdd, updateFoodAmount, updateQuickAdd, type LogEntry } from "../state/log";
import { closeSheet, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "food");
const editing = computed(() => log.entries.find((entry) => entry.id === ui.editEntryId) ?? null);
const editingFood = computed(() => (editing.value && editing.value.source !== "quick" ? editing.value : null));
const showDetail = computed(() => Boolean(ui.detailFoodId || editingFood.value));
const sheetLabel = computed(() => (editing.value ? "Edit food" : "Add food"));

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
const results = ref<FoodSearchRow[]>([]);
const searching = ref(false);
const searchError = ref("");
const hi = ref(0);
const searchEl = ref<HTMLInputElement | null>(null);
const amountEl = ref<HTMLInputElement | null>(null);
const detailFood = ref<FoodSearchRow | null>(null);
const amountText = ref("100");
const unit = ref<UnitChoice["unit"]>("g");
const fresh = ref(true);
const foodChanged = ref(false);
const session = ref<{ name: string; kcal: number }[]>([]);
let searchGen = 0;
let searchTimer = 0;

const sessionKcal = computed(() => session.value.reduce((sum, row) => sum + row.kcal, 0));
const todayKcal = computed(() => dayTotals().kcal);

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
  if (!replace.value[field]) return;
  queueMicrotask(() => {
    const input = document.activeElement;
    if (input instanceof HTMLInputElement && input.getAttribute("aria-label") === fieldLabel(field)) input.select();
  });
}
function onQuickBlur(field: Field) {
  armQuick(field);
}
function onQuickTap(field: Field) {
  if (active.value !== field) armQuick(active.value);
  active.value = field;
  armQuick(field);
}
function fieldLabel(field: Field): string {
  return fields.find((item) => item.key === field)?.label ?? "";
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
  const value = nextQuickInput(qa.value[key], input.value, armed, 6);
  qa.value[key] = value;
  input.value = value;
  if (armed) replace.value[key] = false;
}
function limitMessage(): string | null {
  const kcal = qa.value.kcal !== "" ? num("kcal") : qKcalAuto.value;
  if (kcal < 0 || kcal > 10000) return "Calories should be from 0 to 10,000.";
  if (num("p") < 0 || num("p") > 1000) return "Protein should be from 0 to 1,000 g.";
  if (num("f") < 0 || num("f") > 1000) return "Fat should be from 0 to 1,000 g.";
  if (num("c") < 0 || num("c") > 1000) return "Carbs should be from 0 to 1,000 g.";
  return null;
}
function fill(entry: LogEntry | null) {
  saveError.value = false;
  formError.value = "";
  saving.value = false;
  foodChanged.value = false;
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

const units = computed(() => {
  if (editingFood.value) return unitsForEntry(editingFood.value);
  return detailFood.value ? unitsForFood(detailFood.value) : [];
});
const amountNumber = computed(() => parseAmount(amountText.value));
const preview = computed(() => {
  if (editingFood.value) return scaleStored(editingFood.value, amountNumber.value, unit.value);
  if (detailFood.value) return macrosForFood(detailFood.value, amountNumber.value, unit.value);
  return { kcal: 0, protein: 0, fat: 0, carbs: 0, grams: null as number | null };
});
const isCount = computed(() => unit.value === "serving" || unit.value === "piece");
const unitWord = computed(() => amountLabel(amountNumber.value || 0, unit.value).replace(/^[\d.]+ /, ""));
const gramsEach = computed(() => units.value.find((item) => item.unit === unit.value)?.gramsEach ?? null);
const quickAmounts = computed(() => (unit.value === "g" ? [100, 150, 200] : unit.value === "ml" ? [100, 250, 500] : [0.5, 1, 2, 3]));
const detailTitle = computed(() => detailFood.value?.name ?? editingFood.value?.name ?? "");
const per100 = computed(() => {
  if (detailFood.value && !editingFood.value) return per100Line(detailFood.value);
  const entry = editingFood.value;
  if (!entry) return "";
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
  const goal = profile.targets;
  if (!goal || !keyboardEntry.value) return null;
  const totals = dayTotals();
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
  return english + per100Line(food);
}

function openDetail(food: FoodSearchRow) {
  const start = defaultAmount(food);
  ui.detailFoodId = food.id;
  detailFood.value = food;
  unit.value = start.unit;
  amountText.value = start.amount;
  fresh.value = true;
  foodChanged.value = false;
  formError.value = "";
  saveError.value = false;
  idempotencyKey.value = "";
}
function back() {
  if (editing.value) {
    closeSheet();
    return;
  }
  ui.detailFoodId = null;
  detailFood.value = null;
  formError.value = "";
}
function setUnit(next: UnitChoice) {
  if (next.unit === unit.value) return;
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
function amountInput(event: Event) {
  const input = event.target as HTMLInputElement;
  let value = input.value.replace(",", ".").replace(/[^0-9.]/g, "");
  const decimals = isCount.value ? 2 : 1;
  const maxInt = unit.value === "g" || unit.value === "ml" ? 5 : 2;
  const [whole, fraction] = value.split(".");
  value = fraction === undefined ? (whole ?? "").slice(0, maxInt) : `${(whole ?? "").slice(0, maxInt)}.${fraction.slice(0, decimals)}`;
  amountText.value = value;
  input.value = value;
  fresh.value = false;
}
function searchKey(event: KeyboardEvent) {
  const count = results.value.length;
  if (!count || !keyboardEntry.value) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    hi.value = (hi.value + 1) % count;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    hi.value = (hi.value - 1 + count) % count;
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const food = results.value[Math.min(hi.value, count - 1)];
    if (food) openDetail(food);
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
  const kind = normalizeUnit(entry.unit) ?? (entry.grams == null ? "serving" : "g");
  unit.value = kind;
  amountText.value = String(entry.amount);
  fresh.value = true;
  foodChanged.value = false;
  detailFood.value = null;
  if (!entry.foodId) {
    foodChanged.value = true;
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
  if (!keyboardEntry.value || ui.sheet !== "food") return;
  void nextTick(() => {
    if (showDetail.value) {
      amountEl.value?.focus();
      amountEl.value?.select();
    } else if (ui.foodTab === "search") searchEl.value?.focus();
  });
}
watch(q, scheduleSearch);
watch(() => [ui.sheet, ui.detailFoodId, ui.foodTab, showDetail.value], focusFor);
watch(open, (isOpen) => {
  if (!isOpen) return;
  q.value = "";
  results.value = [];
  searchError.value = "";
  searching.value = false;
  session.value = [];
  detailFood.value = null;
  if (!editingFood.value) ui.detailFoodId = null;
  fill(editing.value);
  if (editingFood.value) {
    ui.detailFoodId = editingFood.value.foodId;
    void prepareEdit(editingFood.value);
  }
});

async function addQuick() {
  if (saving.value) return;
  const limit = limitMessage();
  if (limit) {
    formError.value = limit;
    saveError.value = false;
    return;
  }
  if (!qKcal.value) return;
  formError.value = "";
  saving.value = true;
  const name = qName.value.trim() || "Quick add";
  const values = {
    name,
    kcal: qa.value.kcal !== "" ? num("kcal") : qKcalAuto.value,
    protein: num("p"),
    fat: num("f"),
    carbs: num("c"),
    time: time.value,
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
    if (!idempotencyKey.value) idempotencyKey.value = crypto.randomUUID();
    const result = await saveQuickAdd({
      idempotencyKey: idempotencyKey.value,
      localDate: todayIso(),
      timeZone: deviceTimeZone(),
      ...values,
    });
    if (!result.ok) {
      saveError.value = result.unreachable === true;
      formError.value = result.unreachable ? "" : (result.message ?? "");
      return;
    }
    toast(`Added ${result.entry.name} · ${int(result.entry.kcal)} kcal`);
    session.value.push({ name: result.entry.name, kcal: result.entry.kcal });
    fill(null);
    saveError.value = false;
    ui.foodTab = "search";
  } finally {
    saving.value = false;
  }
}

async function addDetail() {
  if (saving.value) return;
  const limit = amountError(amountNumber.value, unit.value);
  if (limit) {
    formError.value = limit;
    saveError.value = false;
    return;
  }
  formError.value = "";
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
    if (!food) return;
    if (!idempotencyKey.value) idempotencyKey.value = crypto.randomUUID();
    const result = await saveQuickAdd({
      idempotencyKey: idempotencyKey.value,
      localDate: todayIso(),
      timeZone: deviceTimeZone(),
      time: time.value,
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
    session.value.push({ name: result.entry.name, kcal: result.entry.kcal });
    ui.detailFoodId = null;
    detailFood.value = null;
    q.value = "";
    idempotencyKey.value = "";
    saveError.value = false;
    formError.value = "";
  } finally {
    saving.value = false;
  }
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
        <button v-if="showDetail" type="button" class="cbtn" style="--s: 44px" aria-label="Back" @click="back">
          <Icon name="left" :size="18" />
        </button>
        <h2 v-else class="t-head">{{ editing ? "Edit food" : "Add food" }}</h2>
        <span class="grow" />
        <TimeChip v-model="time" :date="todayIso()" :allow-now="!editing" />
        <button type="button" class="cbtn" style="--s: 44px" aria-label="Close" @click="closeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
      <Segmented v-if="!showDetail && !editing" v-model="ui.foodTab" label="Add food" :options="[{ value: 'search', label: 'Search' }, { value: 'quick', label: 'Quick Add' }]" />
      </div>
    </template>

    <div v-if="showDetail" class="body">
      <div class="col center gap2">
        <h3 class="t-head dname">{{ detailTitle }}</h3>
        <span class="t-label c2">{{ per100 }}</span>
        <span v-if="editingFood && foodChanged" class="t-capn c2">Using the values it was logged with — this food has changed since.</span>
      </div>
      <div class="col center gap8">
        <div v-if="keyboardEntry" class="base">
          <input ref="amountEl" :value="amountText" class="t-dl num ginput" inputmode="decimal" autocomplete="off" :aria-label="`Amount in ${unit}`"
            @input="amountInput" @keydown.enter.prevent="addDetail" />
          <span class="t-head c2">{{ unitWord }}</span>
        </div>
        <div v-else class="base" role="status" :aria-label="amountLabel(amountNumber, unit)">
          <span class="t-dl num" data-num>{{ amountText }}</span><span class="t-head c2">{{ unitWord }}</span>
        </div>
        <span v-if="isCount && preview.grams != null && gramsEach" class="t-label c2" aria-live="polite">= {{ int(preview.grams) }} g · 1 {{ unit }} = {{ gramsEach }} g</span>
        <div class="row units" role="radiogroup" aria-label="Unit">
          <button v-for="choice in units" :key="choice.unit" type="button" role="radio" class="uchip t-label" :class="{ on: choice.unit === unit }" :aria-checked="choice.unit === unit" @click="setUnit(choice)">
            {{ choice.label }}<span v-if="choice.gramsEach && choice.unit !== 'g' && choice.unit !== 'ml'" class="ug"> · {{ choice.gramsEach }} g</span>
          </button>
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
          <span class="t-cap c3">Today after {{ editing ? "saving" : "adding" }}</span>
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
      <p v-else class="t-capn c3 khint"><kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> {{ editing ? "close" : "back to search" }}</p>
      <div class="row gap8 actions">
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="saving" @click="addDetail">
          {{ saveError ? "Try again" : editing ? "Save" : "Add" }} · {{ int(preview.kcal) }} kcal
        </button>
      </div>
    </div>

    <template v-else-if="!editing && ui.foodTab === 'search'">
      <label class="field row">
        <Icon name="search" :size="18" class="c2" />
        <input ref="searchEl" v-model="q" class="t-body grow" type="search" placeholder="Search foods" aria-label="Search foods" autocomplete="off" enterkeyhint="search" @keydown="searchKey" />
        <button v-if="q" type="button" class="clr c2" aria-label="Clear search" @click="q = ''"><Icon name="x" :size="16" /></button>
      </label>
      <div class="list">
        <p v-if="searching" class="t-label c2" role="status">Searching…</p>
        <div v-else-if="searchError" class="err col" role="alert">
          <span class="t-label">{{ searchError }}</span>
          <button v-if="q.trim().length >= 2" type="button" class="chip" @click="runSearch(q.trim())">Try again</button>
        </div>
        <button v-for="(food, index) in results" :key="food.id" type="button" class="rrow row" :class="{ hl: keyboardEntry && index === hi }" @click="openDetail(food)" @mouseenter="hi = index">
          <span class="col grow rtext">
            <span class="t-body ell">{{ food.name }}</span>
            <span class="t-label c2 ell">{{ rowSub(food) }}</span>
          </span>
        </button>
        <div v-if="!searching && !searchError && q.trim() && !results.length" class="col emptyc">
          <span class="t-label c2">No match for “{{ q.trim() }}”.</span>
          <button type="button" class="chip t-label" @click="ui.foodTab = 'quick'">Quick Add</button>
        </div>
        <div v-else-if="!searching && !q.trim()" class="col emptyc">
          <span class="t-bodys">Nothing here yet</span>
          <span class="t-label c2">Search for a food above.</span>
        </div>
      </div>
      <div v-if="session.length" class="session" role="status">
        <span class="col stext">
          <span class="t-bodys">{{ session.length }} added · {{ int(sessionKcal) }} kcal</span>
          <span class="t-capn c2">Today · {{ int(todayKcal) }} kcal</span>
        </span>
        <button type="button" class="chip on" @click="closeSheet">Done</button>
      </div>
    </template>

    <div v-else class="body">
      <label class="field row">
        <input v-model="qName" class="t-body grow" type="text" placeholder="Protein bar" aria-label="Name (optional)" autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="keyboardEntry && addQuick()" />
        <span class="t-capn c2">name · optional</span>
      </label>
      <div class="qgrid">
        <template v-if="keyboardEntry">
          <label v-for="field in fields" :key="'k' + field.key" class="qf" :class="{ on: active === field.key }">
            <span class="t-capm c2">{{ field.label }}</span>
            <span class="base">
              <input :value="qa[field.key]" class="t-nm num qinput" inputmode="decimal" autocomplete="off" :aria-label="field.label"
                :placeholder="field.key === 'kcal' && qKcalAuto ? String(qKcalAuto) : '0'"
                @input="qInput(field.key, $event)" @focus="onQuickFocus(field.key)" @blur="onQuickBlur(field.key)" @keydown.enter.prevent="addQuick" />
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
      <p v-else class="t-capn c3 khint"><kbd>Tab</kbd> next field · <kbd>Enter</kbd> {{ editing ? "save" : "add" }} · <kbd>Esc</kbd> close</p>
      <div class="row gap8 actions">
        <button v-if="editing" type="button" class="del-btn t-bodys" aria-label="Delete" :disabled="saving" @click="deleteEdited">
          <Icon name="trash" :size="16" /><span>Delete</span>
        </button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="saving || !qKcal" @click="addQuick">
          {{ saveError ? "Try again" : editing ? "Save" : "Add" }} · {{ int(qKcal) }} kcal
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; min-width: 0; flex-wrap: wrap; }
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
.actions { flex: none; flex-wrap: wrap; }
.actions .primary-btn { width: auto; flex: 1 1 160px; min-width: 0; }
.del-btn { min-height: 52px; min-width: 44px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; }
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dname { margin: 0; overflow-wrap: anywhere; }
.preview { display: flex; justify-content: space-around; gap: 8px; padding: 14px 8px; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.units, .chips { gap: 8px; flex-wrap: wrap; justify-content: center; max-width: 100%; }
.uchip { min-width: 44px; min-height: 44px; padding: 0 12px; border-radius: 22px; border: 1px solid var(--color-border); display: inline-flex; align-items: center; justify-content: center; gap: 2px; background: transparent; color: var(--text-primary); }
.uchip.on { background: var(--color-action); color: var(--color-on-action); border-color: var(--color-action); }
.ug { color: var(--text-secondary); }
.uchip.on .ug { color: var(--color-on-action); }
.after { gap: 12px; padding: 16px; border-radius: var(--radius-card); border: 1px solid var(--color-border); }
.arow { gap: 6px; }
.session { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.stext { flex: 1 1 150px; min-width: 0; }
.dt-l .units, .dt-l .chips { justify-content: center; }
.dt-l .uchip { min-height: 44px; }
.dt-xl .preview { display: grid; grid-template-columns: 1fr 1fr; row-gap: 12px; }
.dt-xl .qgrid { grid-template-columns: 1fr; }
</style>
