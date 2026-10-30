<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import Segmented from "./Segmented.vue";
import TimeChip from "./TimeChip.vue";
import { todayIso } from "../lib/dates";
import { int } from "../lib/format";
import { kcalFromMacros } from "../lib/macros";
import { keyboardEntry } from "../lib/viewport";
import { deviceTimeZone } from "../state/profile";
import { log, removeEntry, saveQuickAdd, updateQuickAdd, type LogEntry } from "../state/log";
import { closeSheet, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "food");
const editing = computed(() => log.entries.find((entry) => entry.id === ui.editEntryId) ?? null);
type Field = "kcal" | "p" | "f" | "c";
const qa = ref<Record<Field, string>>({ kcal: "", p: "", f: "", c: "" });
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

function num(key: Field): number {
  const raw = qa.value[key].trim().replace(",", ".");
  if (!raw || raw === ".") return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
const qKcalAuto = computed(() => Math.round(kcalFromMacros(num("p"), num("f"), num("c"))));
const qKcal = computed(() => (qa.value.kcal !== "" ? Math.round(num("kcal")) : qKcalAuto.value));
const sheetLabel = computed(() => (editing.value ? "Edit food" : "Add food"));

function typeInto(current: string, key: string, maxInt: number): string {
  if (key === "⌫") return current.length <= 1 ? "" : current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : `${current || "0"}.`;
  if (current.includes(".") && current.split(".")[1].length >= 1) return current;
  if (!current.includes(".") && current.replace(/^0/, "").length >= maxInt) return current;
  return current === "0" ? key : current + key;
}
function qKey(key: string) {
  const field = active.value;
  qa.value[field] = typeInto(qa.value[field], key, field === "kcal" ? 5 : 4);
}
function qInput(key: Field, event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value.replace(",", ".").replace(/[^0-9.]/g, "").slice(0, key === "kcal" ? 6 : 6);
  qa.value[key] = value;
  input.value = value;
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
  if (entry) {
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
  time.value = null;
  idempotencyKey.value = "";
}
watch(open, (isOpen) => {
  if (isOpen) fill(editing.value);
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
    fill(null);
    saveError.value = false;
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
  <BottomSheet :open="open" :label="sheetLabel" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head">{{ editing ? "Edit food" : "Add food" }}</h2>
        <span class="grow" />
        <TimeChip v-model="time" :date="todayIso()" :allow-now="!editing" />
        <button type="button" class="cbtn" style="--s: 44px" aria-label="Close" @click="closeSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
      <Segmented v-if="!editing" v-model="ui.foodTab" label="Add food" :options="[{ value: 'search', label: 'Search' }, { value: 'quick', label: 'Quick Add' }]" />
    </template>

    <div v-if="!editing && ui.foodTab === 'search'" class="col emptyc">
      <span class="t-bodys">Search arrives in a later update</span>
      <span class="t-label c2">Quick Add is ready for today.</span>
      <button type="button" class="chip t-label" @click="ui.foodTab = 'quick'">Quick Add</button>
    </div>

    <template v-else>
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
                @input="qInput(field.key, $event)" @focus="active = field.key" @keydown.enter.prevent="addQuick" />
              <span class="t-label c2">{{ field.unit }}</span>
            </span>
          </label>
        </template>
        <template v-else>
          <button v-for="field in fields" :key="field.key" type="button" class="qf" :class="{ on: active === field.key }" :aria-label="field.label" @click="active = field.key">
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
          <span class="t-label c2">Nothing was lost — your entry is still here. server unreachable, try again</span>
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
    </template>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; min-width: 0; flex-wrap: wrap; }
.gap8 { gap: 8px; }
.field { min-height: 44px; padding: 0 12px; gap: 8px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; min-width: 0; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; width: 100%; padding: 0; }
.field input::placeholder { color: var(--text-tertiary); }
.qgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: none; min-width: 0; }
.qf { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; min-height: 72px; border-radius: var(--radius-control); background: var(--color-surface-2); text-align: left; min-width: 0; }
.qf.on, .qf:focus-within { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.qinput { width: 100%; min-width: 0; background: transparent; border: 0; outline: 0; padding: 0; }
.qinput::placeholder { color: var(--text-tertiary); }
.note, .khint { margin: 0; }
.khint { text-align: center; }
.err { gap: 12px; padding: 14px; border-radius: var(--radius-card); border: 1px dashed var(--text-tertiary); flex: none; min-width: 0; }
.err.t-label { margin: 0; }
.emptyc { gap: 8px; padding: 12px 0 20px; }
.actions { flex: none; flex-wrap: wrap; }
.actions .primary-btn { width: auto; flex: 1 1 160px; min-width: 0; }
.del-btn { min-height: 52px; min-width: 44px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; }
.base { min-width: 0; max-width: 100%; flex-wrap: wrap; }
.dt-xl .qgrid { grid-template-columns: 1fr; }
</style>
