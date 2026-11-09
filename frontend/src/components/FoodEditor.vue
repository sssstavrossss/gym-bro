<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  ApiError,
  createCustomFood,
  deleteCustomFood,
  getFood,
  ServerUnreachable,
  updateCustomFood,
  type FoodSearchRow,
} from "../api";
import {
  buildCustomFood,
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
const storedPerServing = ref(false);
const loaded = ref<FoodSearchRow | null>(null);
const ready = ref(!props.editId);
const tried = ref(false);
const saving = ref(false);
const formError = ref("");
const nameEl = ref<HTMLInputElement | null>(null);

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
  storedPerServing.value = perServing;
}

onMounted(async () => {
  if (props.editId) {
    try {
      const food = await getFood(props.editId);
      loaded.value = food;
      applyForm(formFromFood(food), food.nutrientBasis === "per_serving");
    } catch (error) {
      formError.value = error instanceof ApiError ? error.message : "Couldn't open that food.";
    } finally {
      ready.value = true;
    }
  } else {
    applyForm(formFromSeed(props.seed), false);
  }
  await nextTick();
  nameEl.value?.focus({ preventScroll: true });
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
  <form v-if="ready" class="fe col" novalidate @submit.prevent="save">
    <h3 class="t-head">{{ editing ? "Edit my food" : "New food" }}</h3>
    <p v-if="editing" class="note row t-label"><Icon name="info" :size="16" class="c2" />{{ futureLogsNote }}</p>
    <p v-if="formError" class="t-capn errt m0" role="alert">{{ formError }}</p>

    <label class="fl col"><span class="t-capm c2">Name <span aria-hidden="true">*</span></span>
      <input ref="nameEl" v-model="name" class="inp t-body" type="text" autocomplete="off" required :aria-invalid="errName" aria-describedby="fe-name-msg" placeholder="e.g. Lentil soup, home-made" />
      <span id="fe-name-msg" class="t-capn" :class="errName ? 'errt' : 'c2'">{{ errName ? nameRequired : sameName ? duplicateNameNote : "" }}</span>
    </label>
    <label class="fl col"><span class="t-capm c2">Brand · optional</span>
      <input v-model="brand" class="inp t-body" type="text" autocomplete="off" placeholder="e.g. Northbar" />
    </label>

    <div class="col fl">
      <span class="t-capm c2">Values are</span>
      <Segmented v-model="basis" label="Values are" :options="[{ value: '100g', label: 'Per 100 g' }, { value: 'serving', label: 'Per serving' }]" />
    </div>
    <div class="row g8">
      <label class="fl col grow"><span class="t-capm c2">Serving name</span>
        <input v-model="servingName" class="inp t-body" type="text" autocomplete="off" placeholder="serving" />
      </label>
      <label class="fl col grow"><span class="t-capm c2">Serving size · optional</span>
        <span class="inp row t-body"><input v-model="servingGrams" class="bare grow t-body" inputmode="decimal" autocomplete="off" placeholder="e.g. 60" /><span class="c2">g</span></span>
      </label>
    </div>
    <p v-if="servingOnly" class="t-capn c2 m0">{{ servingOnlyNote }}</p>

    <div class="grid4">
      <label v-for="[key, label, unit] in fields" :key="key" class="fl col">
        <span class="t-capm c2">{{ label }}<span v-if="key === 'kcal'" aria-hidden="true"> *</span> <span class="sub">{{ basis === "100g" ? "/100 g" : "/serving" }}</span></span>
        <span class="inp row t-body" :class="{ bad: key === 'kcal' && errKcal }">
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

    <label class="fl col"><span class="t-capm c2">Barcode · optional</span>
      <input v-model="barcode" class="inp t-body" inputmode="numeric" autocomplete="off" placeholder="Number under the barcode" />
      <span class="t-capn c2">Scanning comes in a later version — type the digits for now.</span>
    </label>
    <p class="t-capn c2 m0 priv"><Icon name="lock" :size="12" /> Private — only you see your foods.</p>

    <div class="row g8 actions">
      <button v-if="editing" type="button" class="del-btn t-bodys" :disabled="saving" @click="remove"><Icon name="trash" :size="16" />Delete</button>
      <button type="button" class="sec-btn t-bodys" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="primary-btn t-bodys grow" :disabled="saving">{{ editing ? "Save changes" : "Save food" }}</button>
    </div>
  </form>
  <p v-else class="t-label c2" role="status">Loading…</p>
</template>

<style scoped>
.fe { gap: 12px; padding-bottom: 4px; }
.fe h3 { margin: 0; }
.fl { gap: 4px; min-width: 0; }
.g8 { gap: 8px; }
.m0 { margin: 0; }
.inp { height: 44px; padding: 0 12px; border-radius: var(--radius-control); background: var(--color-surface-2); border: 1px solid transparent; color: var(--text-primary); min-width: 0; gap: 6px; align-items: center; }
input.inp { width: 100%; }
.inp:focus-within, input.inp:focus { border-color: var(--color-action); outline: none; }
.inp.bad { border-color: var(--text-primary); border-style: dashed; }
.bare { background: transparent; border: 0; outline: 0; color: inherit; font: inherit; min-width: 0; padding: 0; height: 100%; width: 100%; }
.inp::placeholder, .bare::placeholder { color: var(--text-tertiary); }
.grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sub { color: var(--text-secondary); font-weight: 400; text-transform: none; letter-spacing: 0; }
.errt { color: var(--text-primary); }
.note { gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); margin: 0; align-items: flex-start; }
.hint { gap: 6px; margin: 0; padding: 8px 10px; border: 1px dashed var(--text-tertiary); border-radius: 10px; color: var(--text-secondary); align-items: flex-start; }
.priv { display: flex; gap: 6px; align-items: center; }
.actions { position: sticky; bottom: 0; padding-top: 8px; background: var(--color-surface); flex-wrap: wrap; }
.actions .primary-btn { width: auto; flex: 1 1 140px; }
.sec-btn, .del-btn { min-height: 52px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); color: var(--text-primary); display: inline-flex; align-items: center; gap: 8px; flex: none; }
</style>
