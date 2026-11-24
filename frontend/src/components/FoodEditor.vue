<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import {
  ApiError,
  createCustomFood,
  deleteCustomFood,
  getFood,
  readLabel,
  ServerUnreachable,
  updateCustomFood,
  type FoodSearchRow,
} from "../api";
import { PHOTO_UNREADABLE, shrinkPhoto } from "../photo/mealPhoto";
import { describe } from "../state/describe";
import {
  buildCustomFood,
  EXTRA_KEYS,
  EXTRA_LABELS,
  formFromLabel,
  hasExtras,
  duplicateNameNote,
  emptyMacroNote,
  formFromFood,
  formFromSeed,
  futureLogsNote,
  kcalRequired,
  macroHint,
  mismatchCopy,
  nameRequired,
  parseCustomNumber,
  sameNameCount,
  savedPer100Copy,
  servingOnlyNote,
  type CustomFoodForm,
  type CustomFoodSeed,
} from "../lib/customFood";
import BarcodeScanner from "./BarcodeScanner.vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";

const props = defineProps<{
  editId?: string | null;
  seed?: CustomFoodSeed | null;
  namesakes: { id: string; name: string }[];
}>();
const emit = defineEmits<{ saved: [FoodSearchRow, boolean]; deleted: [FoodSearchRow]; cancel: [] }>();

const name = ref("");
const brand = ref("");
const barcode = ref("");
const basis = ref<CustomFoodForm["basis"]>("100g");
const servingGrams = ref("");
const servingName = ref("serving");
const kcal = ref("");
const protein = ref("");
const fat = ref("");
const carbs = ref("");
const extra = reactive({ saturatedFat: "", sugars: "", fiber: "", salt: "" });
/** The four extra fields show when asked for, or when one has a value. */
const moreOpen = ref(false);
const storedPerServing = ref(false);
const loaded = ref<FoodSearchRow | null>(null);
const ready = ref(!props.editId);
const tried = ref(false);
const saving = ref(false);
const formError = ref("");
const editing = computed(() => Boolean(props.editId && loaded.value));
const form = computed<CustomFoodForm>(() => ({
  name: name.value,
  brand: brand.value,
  barcode: barcode.value,
  basis: basis.value,
  servingGrams: servingGrams.value,
  servingName: servingName.value,
  kcal: kcal.value,
  protein: protein.value,
  fat: fat.value,
  carbs: carbs.value,
  ...extra,
}));
const built = computed(() => buildCustomFood(form.value, { editingPerServing: storedPerServing.value }));
const kcalNum = computed(() => parseCustomNumber(kcal.value));
const hint = computed(() => macroHint(
  Number.isFinite(kcalNum.value) ? kcalNum.value : 0,
  blankNumber(protein.value),
  blankNumber(fat.value),
  blankNumber(carbs.value),
));
const emptyNames = computed(() => {
  const names: string[] = [];
  if (!protein.value.trim()) names.push("protein");
  if (!fat.value.trim()) names.push("fat");
  if (!carbs.value.trim()) names.push("carbs");
  return names;
});
const errName = computed(() => tried.value && !name.value.trim());
const errKcal = computed(() => tried.value && (!kcal.value.trim() || !(kcalNum.value > 0)));
const sameName = computed(() => sameNameCount(props.namesakes, name.value, props.editId));
const servingOnly = computed(() => basis.value === "serving" && !(parseCustomNumber(servingGrams.value) > 0));
const per100Line = computed(() => (built.value.ok && built.value.preview.per100 ? savedPer100Copy(built.value.preview.per100) : ""));

function blankNumber(raw: string): number {
  if (!raw.trim()) return 0;
  const value = parseCustomNumber(raw);
  return Number.isFinite(value) ? value : 0;
}
function applyForm(next: CustomFoodForm, perServing: boolean) {
  name.value = next.name;
  brand.value = next.brand;
  barcode.value = next.barcode;
  basis.value = next.basis;
  servingGrams.value = next.servingGrams;
  servingName.value = next.servingName;
  kcal.value = next.kcal;
  protein.value = next.protein;
  fat.value = next.fat;
  carbs.value = next.carbs;
  for (const key of EXTRA_KEYS) extra[key] = next[key];
  if (hasExtras(next)) moreOpen.value = true;
  storedPerServing.value = perServing;
}

// A label photo fills the form. Claude reads it; nothing is saved until Save food.
const labelInput = ref<HTMLInputElement | null>(null);
const labelState = ref<"idle" | "reading" | "filled">("idle");
const labelError = ref("");
/** Only a new food, and only while Describe is on: the same key and the same daily limit. */
const canLabel = computed(() => describe.available && !props.editId);

function pickLabel() {
  if (labelState.value === "reading") return;
  labelInput.value?.click();
}

async function onLabelPicked() {
  const file = labelInput.value?.files?.[0];
  if (labelInput.value) labelInput.value.value = "";
  if (!file) return;
  labelState.value = "reading";
  labelError.value = "";
  try {
    const photo = await shrinkPhoto(file).catch(() => {
      throw new Error(PHOTO_UNREADABLE);
    });
    const read = await readLabel(photo);
    describe.left = read.left;
    applyForm(formFromLabel(form.value, read), storedPerServing.value);
    tried.value = false;
    formError.value = "";
    labelState.value = "filled";
  } catch (error) {
    if (error instanceof ServerUnreachable) labelError.value = "Server unreachable, try again.";
    else labelError.value = error instanceof Error && error.message ? error.message : "Couldn't read that label.";
    labelState.value = "idle";
  }
}

// Scanning puts the number in the Barcode field. It looks nothing up: this food is being made.
const scanning = ref(false);
function scanBarcode() {
  scanning.value = true;
}
function onScanned(code: string) {
  barcode.value = code;
  scanning.value = false;
}
/** Back while scanning returns to the form. True when it did. */
function leaveScan(): boolean {
  if (!scanning.value) return false;
  scanning.value = false;
  return true;
}

defineExpose({ canLabel, labelState, scanning, pickLabel, scanBarcode, leaveScan });

if (!props.editId) applyForm(formFromSeed(props.seed), false);

onMounted(async () => {
  if (!props.editId) return;
  try {
    const food = await getFood(props.editId);
    loaded.value = food;
    applyForm(formFromFood(food), food.nutrientBasis === "per_serving");
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : "Couldn't open that food.";
  } finally {
    ready.value = true;
  }
});

async function save() {
  if (saving.value) return;
  tried.value = true;
  const result = built.value;
  if (!result.ok) {
    formError.value = result.field === "form" ? result.message : "";
    await nextTick();
    (document.querySelector(".fe [aria-invalid='true']") as HTMLElement | null)?.focus();
    return;
  }
  formError.value = "";
  saving.value = true;
  try {
    const food = props.editId
      ? await updateCustomFood(props.editId, result.payload)
      : await createCustomFood(result.payload);
    emit("saved", food, !props.editId);
  } catch (error) {
    if (error instanceof ServerUnreachable) formError.value = "Server unreachable, try again.";
    else formError.value = error instanceof ApiError ? error.message : "Couldn't save that food.";
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const food = loaded.value;
  if (!food || saving.value) return;
  saving.value = true;
  try {
    await deleteCustomFood(food.id);
    emit("deleted", food);
  } catch (error) {
    if (error instanceof ServerUnreachable) formError.value = "Server unreachable, try again.";
    else formError.value = error instanceof ApiError ? error.message : "Couldn't delete that food.";
  } finally {
    saving.value = false;
  }
}

const fields = [
  ["kcal", "Calories", "kcal"],
  ["protein", "Protein", "g"],
  ["fat", "Fat", "g"],
  ["carbs", "Carbs", "g"],
] as const;
</script>

<template>
  <div v-if="scanning" class="col fe">
    <h3 class="t-head">Scan the barcode</h3>
    <BarcodeScanner pick @code="onScanned" />
  </div>
  <form v-else-if="ready" class="fe col" novalidate @submit.prevent="save">
    <h3 class="t-head">{{ editing ? "Edit my food" : "New food" }}</h3>
    <p v-if="editing" class="well note row t-label"><Icon name="info" :size="16" class="c2" />{{ futureLogsNote }}</p>
    <p v-if="formError" class="t-capn errt m0" role="alert">{{ formError }}</p>
    <div v-if="canLabel" class="col lbl" data-label>
      <!-- Without capture, a phone offers both the camera and the photo library. -->
      <input ref="labelInput" type="file" accept="image/*" hidden data-label-input @change="onLabelPicked" />
      <div class="row lrow">
        <button type="button" class="btn sm secondary t-label" :disabled="labelState === 'reading'" @click="pickLabel">
          <Icon name="camera" :size="14" /><span>{{ labelState === "reading" ? "Reading the label…" : labelState === "filled" || labelError ? "Try another photo" : "Fill from a label photo" }}</span>
        </button>
      </div>
      <p v-if="labelError" class="hint row t-capn" role="alert"><Icon name="alert" :size="14" class="c2" />{{ labelError }}</p>
      <p v-else-if="labelState === 'filled'" class="t-capn c2 m0 row lnote" role="status"><Icon name="sparkle" :size="13" />Filled from the label. Check the numbers before you save.</p>
      <p v-else class="t-capn c2 m0">Photograph the nutrition table to fill in the form.</p>
    </div>

    <label class="fl col"><span class="t-capm c2">Name <span aria-hidden="true">*</span></span>
      <input v-autofocus v-model="name" class="field t-body" type="text" autocomplete="off" required :aria-invalid="errName" aria-describedby="fe-name-msg" placeholder="e.g. Lentil soup, home-made" />
      <span id="fe-name-msg" class="t-capn" :class="errName ? 'errt' : 'c2'">{{ errName ? nameRequired : sameName ? duplicateNameNote : "" }}</span>
    </label>
    <label class="fl col"><span class="t-capm c2">Brand · optional</span>
      <input v-model="brand" class="field t-body" type="text" autocomplete="off" placeholder="e.g. Northbar" />
    </label>

    <div class="col fl">
      <span class="t-capm c2">Values are</span>
      <Segmented v-model="basis" label="Values are" :options="[{ value: '100g', label: 'Per 100 g' }, { value: 'serving', label: 'Per serving' }]" />
    </div>
    <div class="row g8">
      <label class="fl col grow"><span class="t-capm c2">Serving name</span>
        <input v-model="servingName" class="field t-body" type="text" autocomplete="off" placeholder="serving" />
      </label>
      <label class="fl col grow"><span class="t-capm c2">Serving size · optional</span>
        <span class="field t-body"><input v-model="servingGrams" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="e.g. 60" /><span class="c2">g</span></span>
      </label>
    </div>
    <p v-if="servingOnly" class="t-capn c2 m0">{{ servingOnlyNote }}</p>

    <div class="grid4">
      <label v-for="[key, label, unit] in fields" :key="key" class="fl col">
        <span class="t-capm c2">{{ label }}<span v-if="key === 'kcal'" aria-hidden="true"> *</span> <span class="sub">{{ basis === "100g" ? "/100 g" : "/serving" }}</span></span>
        <span class="field t-body" :class="{ bad: key === 'kcal' && errKcal }">
          <input v-if="key === 'kcal'" v-model="kcal" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="0" required :aria-invalid="errKcal" />
          <input v-else-if="key === 'protein'" v-model="protein" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="0" />
          <input v-else-if="key === 'fat'" v-model="fat" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="0" />
          <input v-else v-model="carbs" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="0" />
          <span class="c2">{{ unit }}</span>
        </span>
      </label>
    </div>
    <p v-if="errKcal" class="t-capn errt m0" role="alert">{{ kcalRequired }}</p>
    <p v-else-if="emptyNames.length && kcalNum > 0" class="t-capn c2 m0">{{ emptyMacroNote(emptyNames) }}</p>
    <p v-if="hint.mismatch" class="hint row t-capn" role="status"><Icon name="alert" :size="14" class="c2" />{{ mismatchCopy(hint.expectedKcal) }}</p>
    <p v-if="per100Line" class="t-capn c2 m0">{{ per100Line }}</p>
    <div v-if="moreOpen" class="grid4" data-extras>
      <label v-for="key in EXTRA_KEYS" :key="key" class="fl col">
        <span class="t-capm c2">{{ EXTRA_LABELS[key] }} <span class="sub">{{ basis === "100g" ? "/100 g" : "/serving" }}</span></span>
        <span class="field t-body">
          <input v-model="extra[key]" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="optional" />
          <span class="c2">g</span>
        </span>
      </label>
    </div>
    <div v-else class="row lrow">
      <button type="button" class="btn sm secondary t-label" @click="moreOpen = true"><Icon name="plus" :size="14" :sw="2.4" /><span>More nutrients</span></button>
    </div>

    <label class="fl col"><span class="t-capm c2">Barcode · optional</span>
      <input v-model="barcode" class="field t-body" inputmode="numeric" autocomplete="off" placeholder="Number under the barcode" />
      <span class="t-capn c2">Scan it with the barcode button at the top, so the next scan finds this food.</span>
    </label>
    <p class="t-capn c2 m0 priv"><Icon name="lock" :size="12" /> Private — only you see your foods.</p>

    <div class="row g8 actions">
      <button v-if="editing" type="button" class="btn secondary t-bodys" :disabled="saving" @click="remove"><Icon name="trash" :size="16" />Delete</button>
      <button type="button" class="btn secondary t-bodys" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="btn primary block t-bodys grow" :disabled="saving">{{ editing ? "Save changes" : "Save food" }}</button>
    </div>
  </form>
  <p v-else class="t-label c2" role="status">Loading…</p>
</template>

<style scoped>
.fe { gap: var(--space-m); padding-bottom: var(--space-xs); }
.fe h3 { margin: 0; }
.fl { gap: var(--space-xs); min-width: 0; }
.g8 { gap: var(--space-s); }
.m0 { margin: 0; }
input.field { width: 100%; }
.field.bad { box-shadow: inset 0 0 0 1.5px var(--text-primary); }
.bare { background: transparent; border: 0; outline: 0; color: inherit; font: inherit; min-width: 0; padding: 0; height: 100%; width: 100%; }
.bare::placeholder { color: var(--text-tertiary); }
.grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-s); }
.sub { color: var(--text-secondary); font-weight: 400; text-transform: none; letter-spacing: 0; }
.errt { color: var(--text-primary); }
.note { gap: var(--space-s); margin: 0; align-items: flex-start; }
.hint { gap: var(--space-s); margin: 0; padding: var(--space-s) var(--space-m); border: 1px dashed var(--text-tertiary); border-radius: var(--radius-m); color: var(--text-secondary); align-items: flex-start; }
.lbl { gap: var(--space-xs); }
/* A small button's 44px hit overhangs its 30px face, so the row stays as tall as the face. */
.lrow { margin: calc((var(--control-chip) - var(--control-hit)) / 2) 0; }
.lnote { gap: var(--space-xs); align-items: center; }
.priv { display: flex; gap: var(--space-s); align-items: center; }
.actions { position: sticky; bottom: 0; padding-top: var(--space-s); background: var(--color-surface); flex-wrap: wrap; }
.actions .btn.primary { width: auto; flex: 1 1 140px; }
</style>
