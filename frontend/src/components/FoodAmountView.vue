<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import AmountScreen, { type AmountChip, type AmountUnit } from "./AmountScreen.vue";
import Icon from "./Icon.vue";
import NutrientCard from "./NutrientCard.vue";
import { primeKeyboard } from "../lib/focusField";
import type { OwnServing } from "../lib/foodAmount";
import type { MacroAmounts, MacroGoal } from "../lib/macros";
import type { FoodAmount } from "../lib/useFoodAmount";

/**
 * A food's amount screen: its name, the amount with its units, quick amounts and serving form,
 * and the nutrient card for that amount. The food sheet logs from it and the recipe sheet adds an
 * ingredient from it. State lives in `useFoodAmount`; the layout is `AmountScreen`.
 */
const props = withDefaults(defineProps<{
  amount: FoodAmount;
  /** The Macros page's title: "Today after adding", "This ingredient". */
  macroTitle: string;
  /** Targets for the Macros bars. Without one the page lists the amounts. */
  goal?: MacroGoal | null;
  /** Totals the food is added to (the day, less an entry being edited). */
  before?: MacroAmounts;
}>(), { goal: null, before: () => ({ kcal: 0, p: 0, f: 0, c: 0 }) });
const emit = defineEmits<{ submit: [] }>();

const a = reactive(props.amount);
const screen = ref<InstanceType<typeof AmountScreen> | null>(null);
const field = computed(() => screen.value?.field ?? null);
defineExpose({ field });

const after = computed<MacroAmounts>(() => ({
  kcal: props.before.kcal + a.adding.kcal,
  p: props.before.p + a.adding.p,
  f: props.before.f + a.adding.f,
  c: props.before.c + a.adding.c,
}));

// A serving this person added reads like a piece: "slice · 35 g", not "1 slice = 35 g".
const units = computed<AmountUnit[]>(() => a.units.map((choice) => ({
  id: choice.unit,
  label: choice.named ? choice.unit : choice.label,
  detail: choice.gramsEach && choice.unit !== "g" && choice.unit !== "ml" ? ` · ${a.size(choice.gramsEach)}` : undefined,
  spoken: choice.named ? " your serving" : undefined,
  on: choice.unit === a.unit,
})));
const chips = computed<AmountChip[]>(() => a.quickAmounts.map((chip) => ({ id: chip.id, label: chip.label })));

function setUnit(id: string) {
  const choice = a.units.find((item) => item.unit === id);
  if (choice) a.setUnit(choice);
}
function setChip(id: string) {
  const chip = a.quickAmounts.find((item) => item.id === id);
  if (chip) a.pickChip(chip);
}
function toggleServing() {
  if (!a.servingOpen) primeKeyboard();
  a.toggleServingForm();
}
function editServing(row: OwnServing) {
  primeKeyboard();
  a.editServing(row);
}
</script>

<template>
  <AmountScreen
    ref="screen"
    :title="a.title"
    :amount-text="a.amountText"
    :field-label="`Amount in ${a.fieldUnit}`"
    :unit-word="a.unitWord"
    :units="units"
    units-label="Unit"
    :chips="chips"
    @focus="a.fresh = true"
    @input="a.input"
    @submit="emit('submit')"
    @unit="setUnit"
    @chip="setChip"
    @key="a.key"
  >
    <template #meta>
      <slot name="meta" />
      <span class="per100">{{ a.per100 }}</span>
      <slot name="meta-end" />
    </template>
    <template #notice><slot name="notice" /></template>
    <template #subline>
      <!-- One piece's size is on its unit chip, so this is only the total. -->
      <span v-if="a.isCount && a.preview.grams != null && a.gramsEach" aria-live="polite">= {{ a.size(a.preview.grams, true) }}</span>
      <span v-else-if="a.metricLine" aria-live="polite" data-metric-line>{{ a.metricLine }}</span>
    </template>
    <template #units-end>
      <button v-if="a.canAddServing" type="button" class="btn sm secondary t-label addsv" aria-label="Add a serving" :aria-expanded="a.servingOpen" @click="toggleServing"><Icon name="plus" :size="16" :sw="2.4" /></button>
    </template>
    <template #extra>
      <div v-if="a.servingOpen" class="well svform col">
        <div class="row gap8 wrapc">
          <span class="t-label">1</span>
          <input v-model="a.servingNameText" v-autofocus class="field sinp t-body" type="text" maxlength="16" autocomplete="off" aria-label="Serving name" placeholder="slice" />
          <span class="t-label">=</span>
          <input v-model="a.servingGrams" class="field sinp t-body num" inputmode="decimal" autocomplete="off" :aria-label="`${a.servingWord === 'oz' ? 'Ounces' : 'Grams'} in one serving`" :placeholder="a.servingWord === 'oz' ? '1.2' : '35'" @keydown.enter.prevent="a.saveServing" />
          <span class="t-label c2">{{ a.servingWord }}</span>
          <button type="button" class="btn sm primary t-label" :disabled="Boolean(a.servingProblem) || a.savingServing" @click="a.saveServing"><Icon name="check" :size="14" :sw="2.4" /> Save</button>
        </div>
        <div class="row gap8 wrapc">
          <span class="t-capn c2"><Icon name="lock" :size="10" :sw="2.4" /> Private — only you see your servings.</span>
          <button v-for="row in a.ownServings" :key="'e' + row.id" type="button" class="btn sm secondary t-label" @click="editServing(row)"><Icon name="edit" :size="14" /> Edit “{{ row.name }}”</button>
          <button v-for="row in a.ownServings" :key="'d' + row.id" type="button" class="btn sm secondary t-label" :aria-label="`Remove serving ${row.name}`" @click="a.dropServing(row)"><Icon name="trash" :size="14" /> Remove “{{ row.name }}”</button>
        </div>
        <p v-if="a.servingProblem && (a.servingNameText.trim() || a.servingGrams.trim())" class="t-capn errline" role="status">{{ a.servingProblem }}</p>
      </div>
    </template>
    <template #card>
      <NutrientCard :title="macroTitle" :goal="goal" :eaten="after" :adding="a.adding" :values="a.values" :entries="a.sources" :carbs="a.preview.carbs" portion :per100="a.per100Values" label="Food nutrients" />
    </template>
    <template #alerts><slot name="alerts" /></template>
    <template #hint><slot name="hint" /></template>
    <template #note><slot name="note" /></template>
    <template #actions><slot name="actions" /></template>
  </AmountScreen>
</template>

<style scoped>
.per100 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.addsv { padding-inline: var(--space-s); min-width: 36px; justify-content: center; }
.gap8 { gap: var(--space-s); }
.wrapc { flex-wrap: wrap; justify-content: center; }
.svform { gap: var(--space-s); align-items: center; width: 100%; }
.field { flex: none; }
.sinp { width: 110px; }
.sinp.num { width: 72px; }
.errline { margin: 0; color: var(--text-secondary); min-height: 1.2em; }
html.dt-xl .per100 { overflow: visible; text-overflow: clip; white-space: normal; }
</style>
