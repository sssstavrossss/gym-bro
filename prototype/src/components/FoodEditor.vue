<script setup lang="ts">
// Create or edit one of "My foods" (S3). Values can be typed per 100 g or per serving; they are always
// stored per 100 g. Native inputs (a form, not a speed path), so labels, autofill and screen readers just work.
import { computed, nextTick, onMounted, ref } from "vue";
import Segmented from "./Segmented.vue";
import Icon from "./Icon.vue";
import { createFood, deleteFood, findFood, state, updateFood } from "../store";
import { kcalFromMacros } from "../lib/nutrition";
import { int } from "../lib/format";
import type { Food } from "../data/foods";

const props = defineProps<{ editId?: string | null; seed?: { name?: string; kcal?: number; p?: number; f?: number; c?: number } | null }>();
const emit = defineEmits<{ saved: [Food, boolean]; deleted: [Food]; cancel: [] }>();

const editing = computed(() => (props.editId ? findFood(props.editId) : undefined));
const name = ref(""); const brand = ref(""); const barcode = ref("");
const basis = ref<"100g" | "serving">("100g");
const servingG = ref(""); const servingName = ref("serving");
const v = ref({ kcal: "", p: "", f: "", c: "" });
const tried = ref(false);
const nameEl = ref<HTMLInputElement | null>(null);

onMounted(() => {
  const f = editing.value;
  if (f) {
    name.value = f.name; brand.value = f.brand ?? ""; barcode.value = f.barcode ?? "";
    const sv = f.servings?.[0];
    if (f.servingOnly && sv) { basis.value = "serving"; servingName.value = sv.name; v.value = { kcal: fmt(f.kcal), p: fmt(f.p), f: fmt(f.f), c: fmt(f.c) }; }
    else { if (sv) { servingG.value = String(sv.g); servingName.value = sv.name; } v.value = { kcal: fmt(f.kcal), p: fmt(f.p), f: fmt(f.f), c: fmt(f.c) }; }
  } else if (props.seed) {
    // from Quick Add: the numbers are for what was eaten, i.e. one serving
    basis.value = "serving";
    name.value = props.seed.name ?? "";
    v.value = { kcal: fmt(props.seed.kcal ?? 0), p: fmt(props.seed.p ?? 0), f: fmt(props.seed.f ?? 0), c: fmt(props.seed.c ?? 0) };
  }
  nextTick(() => nameEl.value?.focus({ preventScroll: true }));
});
function fmt(n: number) { return n ? String(Math.round(n * 10) / 10) : ""; }
const num = (s: string) => Number(s.replace(",", ".")) || 0;
const sg = computed(() => num(servingG.value));
const kcal = computed(() => num(v.value.kcal));
const calc = computed(() => kcalFromMacros(num(v.value.p), num(v.value.f), num(v.value.c)));
/** Spec: a gentle hint when kcal is >20 % off the 4/9/4 maths — never blocks saving. */
const mismatch = computed(() => kcal.value > 0 && calc.value > 0 && Math.abs(kcal.value - calc.value) / kcal.value > 0.2);
const zeroMacros = computed(() => (["p", "f", "c"] as const).filter((k) => v.value[k].trim() === ""));
const errName = computed(() => tried.value && !name.value.trim());
const errKcal = computed(() => tried.value && !kcal.value);
const sameName = computed(() => state.myFoods.filter((f) => !f.deleted && f.id !== props.editId && f.name.trim().toLowerCase() === name.value.trim().toLowerCase()).length);
/** what gets stored, per 100 g */
const per100 = computed(() => {
  const k = basis.value === "serving" && sg.value ? 100 / sg.value : 1;
  const r = (x: number) => Math.round(x * k * 10) / 10;
  return { kcal: r(kcal.value), p: r(num(v.value.p)), f: r(num(v.value.f)), c: r(num(v.value.c)) };
});
const servingOnly = computed(() => basis.value === "serving" && !sg.value);

function save() {
  tried.value = true;
  if (!name.value.trim() || !kcal.value) {
    nextTick(() => (document.querySelector(".fe [aria-invalid='true']") as HTMLElement | null)?.focus());
    return;
  }
  const servings = sg.value ? [{ name: servingName.value.trim() || "serving", g: sg.value }] : servingOnly.value ? [{ name: servingName.value.trim() || "serving", g: 100 }] : [];
  const data = {
    name: name.value.trim(), brand: brand.value.trim() || undefined, barcode: barcode.value.trim() || undefined,
    ...per100.value, servings, servingOnly: servingOnly.value,
    usual: servings[0]?.g ?? 100, usualUnit: servings[0]?.name ?? "g", usualAmount: servings[0] ? 1 : 100,
  };
  if (editing.value) { updateFood(editing.value.id, data); emit("saved", findFood(editing.value.id)!, false); }
  else emit("saved", createFood(data), true);
}
function remove() { const f = editing.value; if (!f) return; deleteFood(f.id); emit("deleted", f); }
const FIELDS = [["kcal", "Calories", "kcal"], ["p", "Protein", "g"], ["f", "Fat", "g"], ["c", "Carbs", "g"]] as const;
</script>

<template>
  <form class="fe col" novalidate @submit.prevent="save">
    <h3 class="t-head">{{ editing ? "Edit my food" : "New food" }}</h3>
    <p v-if="editing" class="note row t-label"><Icon name="info" :size="16" class="c2" />Changes apply to future logs only. Past entries keep the values they were logged with.</p>

    <label class="fl col"><span class="t-capm c2">Name <span aria-hidden="true">*</span></span>
      <input ref="nameEl" v-model="name" class="inp t-body" type="text" autocomplete="off" required :aria-invalid="errName" aria-describedby="fe-name-msg" placeholder="e.g. Lentil soup, home-made" />
      <span id="fe-name-msg" class="t-capn" :class="errName ? 'errt' : 'c2'">{{ errName ? "Add a name to save this food." : sameName ? "You already have a food with this name — add a brand to tell them apart." : "" }}</span>
    </label>
    <label class="fl col"><span class="t-capm c2">Brand · optional</span>
      <input v-model="brand" class="inp t-body" type="text" autocomplete="off" placeholder="e.g. Northbar" />
    </label>

    <div class="col fl">
      <span id="fe-basis" class="t-capm c2">Values are</span>
      <Segmented v-model="basis" aria-labelledby="fe-basis" :options="[{ value: '100g', label: 'Per 100 g' }, { value: 'serving', label: 'Per serving' }]" :height="40" />
    </div>
    <div class="row g8">
      <label class="fl col grow"><span class="t-capm c2">Serving name</span>
        <input v-model="servingName" class="inp t-body" type="text" autocomplete="off" placeholder="serving" />
      </label>
      <label class="fl col grow"><span class="t-capm c2">Serving size · optional</span>
        <span class="inp row t-body"><input v-model="servingG" class="bare grow" inputmode="decimal" autocomplete="off" placeholder="e.g. 60" aria-label="Serving size in grams" /><span class="c2">g</span></span>
      </label>
    </div>
    <p v-if="servingOnly" class="t-capn c2 m0">No serving size: you'll log this food by serving only. Add the weight to log it in grams too.</p>

    <div class="grid4">
      <label v-for="[k, l, u] in FIELDS" :key="k" class="fl col">
        <span class="t-capm c2">{{ l }}<span v-if="k === 'kcal'" aria-hidden="true"> *</span> <span class="sub">{{ basis === "100g" ? "/100 g" : "/serving" }}</span></span>
        <span class="inp row t-body" :class="{ bad: k === 'kcal' && errKcal }"><input v-model="v[k]" class="bare grow" inputmode="decimal" autocomplete="off" :placeholder="k === 'kcal' ? '0' : '0'" :required="k === 'kcal'" :aria-invalid="k === 'kcal' && errKcal" :aria-label="`${l} ${basis === '100g' ? 'per 100 g' : 'per serving'} in ${u}`" /><span class="c2">{{ u }}</span></span>
      </label>
    </div>
    <p v-if="errKcal" class="t-capn errt m0" role="alert">Calories are needed to save this food.</p>
    <p v-else-if="zeroMacros.length && kcal" class="t-capn c2 m0">Empty {{ zeroMacros.map((k) => ({ p: "protein", f: "fat", c: "carbs" })[k]).join(", ") }} count{{ zeroMacros.length === 1 ? "s" : "" }} as 0 g.</p>
    <p v-if="mismatch" class="hint row t-capn" role="status"><Icon name="alert" :size="14" class="c2" />Calories don't match the macros: P·F·C give about {{ int(calc) }} kcal. Worth checking the label — you can still save.</p>
    <p v-if="basis === 'serving' && sg && kcal" class="t-capn c2 m0">Saved as {{ per100.kcal }} kcal · P{{ per100.p }} F{{ per100.f }} C{{ per100.c }} per 100 g.</p>

    <label class="fl col"><span class="t-capm c2">Barcode · optional</span>
      <input v-model="barcode" class="inp t-body" inputmode="numeric" autocomplete="off" placeholder="Number under the barcode" />
      <span class="t-capn c2">Scanning comes in a later version — type the digits for now.</span>
    </label>
    <p class="t-capn c2 m0 priv"><Icon name="lock" :size="12" /> Private — only you see your foods.</p>

    <div class="row g8 actions">
      <button v-if="editing" type="button" class="del-btn t-bodys" @click="remove"><Icon name="trash" :size="16" />Delete</button>
      <button type="button" class="sec-btn t-bodys" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="primary-btn t-bodys grow">{{ editing ? "Save changes" : "Save food" }}</button>
    </div>
  </form>
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
.inp.bad, .inp[aria-invalid="true"] { border-color: var(--text-primary); border-style: dashed; }
.bare { background: transparent; border: 0; outline: 0; color: inherit; font: inherit; min-width: 0; padding: 0; height: 100%; }
.inp::placeholder, .bare::placeholder { color: var(--text-tertiary); }
.grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sub { color: var(--text-secondary); font-weight: 400; text-transform: none; letter-spacing: 0; }
.errt { color: var(--text-primary); }
.errt::before { content: "! "; font-weight: 700; }
.note { gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); margin: 0; align-items: flex-start; }
.hint { gap: 6px; margin: 0; padding: 8px 10px; border: 1px dashed var(--text-tertiary); border-radius: 10px; color: var(--text-secondary); align-items: flex-start; }
.priv { display: flex; gap: 6px; align-items: center; }
.actions { position: sticky; bottom: 0; padding-top: 8px; background: var(--color-surface); }
.actions .primary-btn { width: auto; }
.sec-btn, .del-btn { height: 52px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); color: var(--text-primary); display: inline-flex; align-items: center; gap: 8px; flex: none; }
@media (min-width: 900px) { .grid4 { grid-template-columns: repeat(4, 1fr); } }
</style>
