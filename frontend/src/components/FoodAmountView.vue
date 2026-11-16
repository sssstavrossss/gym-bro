<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import MacroRows from "./MacroRows.vue";
import NutrientPanelSet from "./NutrientPanelSet.vue";
import SwipePanels from "./SwipePanels.vue";
import { primeKeyboard } from "../lib/focusField";
import { amountLabel, type OwnServing } from "../lib/foodAmount";
import { int } from "../lib/format";
import type { MacroAmounts, MacroGoal } from "../lib/macros";
import { fatLimitsOf } from "../lib/nutrientCards";
import { panelsForSize } from "../lib/nutrients";
import { markWholeSelection } from "../lib/quickEntry";
import type { FoodAmount } from "../lib/useFoodAmount";
import { keyboardEntry } from "../lib/viewport";
import { nutrientPerson, profile } from "../state/profile";

/**
 * The amount screen: a food's name, the amount in large type with its units and quick
 * amounts, the nutrient swipe card for that amount, and the keypad. The food sheet logs
 * from it and the recipe sheet adds an ingredient from it. State lives in `useFoodAmount`.
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
const field = ref<HTMLInputElement | null>(null);
defineExpose({ field });

const after = computed<MacroAmounts>(() => ({
  kcal: props.before.kcal + a.adding.kcal,
  p: props.before.p + a.adding.p,
  f: props.before.f + a.adding.f,
  c: props.before.c + a.adding.c,
}));
const person = computed(() => nutrientPerson(props.goal?.kcal ?? null));
const fatLimits = computed(() => fatLimitsOf(profile.saved?.fatLimits));
const large = ref(false);
const panels = computed(() => panelsForSize(large.value));
function readSize() { large.value = document.documentElement.classList.contains("dt-xl"); }
onMounted(() => {
  readSize();
  window.addEventListener("resize", readSize);
});
onBeforeUnmount(() => window.removeEventListener("resize", readSize));

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
  <div class="amount-screen">
    <div class="col center lead">
      <h3 class="t-head dname">{{ a.title }}</h3>
      <span class="row gap6 t-label c2 wrapc">
        <slot name="meta" />
        <span>{{ a.per100 }}</span>
        <slot name="meta-end" />
      </span>
      <slot name="notice" />
    </div>
    <div class="col center amount-block">
      <div class="base">
        <input ref="field" v-autofocus :value="a.amountText" data-replace="1" class="t-dl num ginput" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="`Amount in ${a.unit}`"
          @beforeinput="markWholeSelection" @focus="a.fresh = true" @input="a.input" @keydown.enter.prevent="emit('submit')" />
        <span class="t-head c2 unitword">{{ a.unitWord }}</span>
      </div>
      <span v-if="a.isCount && a.preview.grams != null && a.gramsEach" class="t-label c2" aria-live="polite">= {{ int(a.preview.grams) }} g<template v-if="a.amountNumber !== 1"> · 1 {{ a.unitWord1 }} = {{ a.gramsEach }} g</template></span>
      <div class="row units">
        <div class="unit-radios" role="radiogroup" aria-label="Unit">
          <button v-for="choice in a.units" :key="choice.unit" type="button" role="radio" class="chip t-label" :class="{ on: choice.unit === a.unit }" :aria-checked="choice.unit === a.unit" @click="a.setUnit(choice)">
            {{ choice.label }}<span v-if="choice.gramsEach && choice.unit !== 'g' && choice.unit !== 'ml' && !choice.named" class="ug"> · {{ choice.gramsEach }} g</span><span v-if="choice.named" class="sr-only"> your serving</span>
          </button>
        </div>
        <button v-if="a.canAddServing" type="button" class="btn sm secondary t-label" :aria-expanded="a.servingOpen" @click="toggleServing"><Icon name="plus" :size="14" :sw="2.4" /> Serving</button>
      </div>
      <div v-if="a.servingOpen" class="well svform col">
        <div class="row gap8 wrapc">
          <span class="t-label">1</span>
          <input v-model="a.servingNameText" v-autofocus class="field sinp t-body" type="text" maxlength="16" autocomplete="off" aria-label="Serving name" placeholder="slice" />
          <span class="t-label">=</span>
          <input v-model="a.servingGrams" class="field sinp t-body num" inputmode="decimal" autocomplete="off" aria-label="Grams in one serving" placeholder="35" @keydown.enter.prevent="a.saveServing" />
          <span class="t-label c2">g</span>
          <button type="button" class="btn sm primary t-label" :disabled="Boolean(a.servingProblem) || a.savingServing" @click="a.saveServing"><Icon name="check" :size="14" :sw="2.4" /> Save</button>
        </div>
        <div class="row gap8 wrapc">
          <span class="t-capn c2"><Icon name="lock" :size="10" :sw="2.4" /> Private — only you see your servings.</span>
          <button v-for="row in a.ownServings" :key="'e' + row.id" type="button" class="btn sm secondary t-label" @click="editServing(row)"><Icon name="edit" :size="14" /> Edit “{{ row.name }}”</button>
          <button v-for="row in a.ownServings" :key="'d' + row.id" type="button" class="btn sm secondary t-label" :aria-label="`Remove serving ${row.name}`" @click="a.dropServing(row)"><Icon name="trash" :size="14" /> Remove “{{ row.name }}”</button>
        </div>
        <p v-if="a.servingProblem && (a.servingNameText.trim() || a.servingGrams.trim())" class="t-capn errline" role="status">{{ a.servingProblem }}</p>
      </div>
      <div class="row gap8 chips">
        <button v-for="value in a.quickAmounts" :key="value" type="button" class="chip t-label" @click="a.setAmount(value)">{{ amountLabel(value, a.unit) }}</button>
      </div>
    </div>
    <div class="preview" aria-live="polite">
      <SwipePanels tight :count="panels.length + 1" :lock-index="-1" label="Food nutrients">
        <MacroRows :title="macroTitle" :goal="goal" :eaten="after" :adding="a.adding" />
        <NutrientPanelSet :panels="panels" :values="a.values" :entries="a.sources" :carbs="a.preview.carbs" :person="person" :fat-limits="fatLimits" :large="large" portion :per100="a.per100Values" />
      </SwipePanels>
    </div>
    <div class="grow" />
    <slot name="alerts" />
    <Keypad v-if="!keyboardEntry" @key="a.key" />
    <!-- With a keyboard instead of the keypad: what Enter and Esc do. -->
    <p v-else class="t-capn c3 khint keyhint"><slot name="hint" /></p>
    <div class="row gap8 actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
/* Its own class: a parent's scoped `.body` would also reach this root and change the gap. */
.amount-screen { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: calc(var(--space-m) / 6); }
.center { align-items: center; text-align: center; }
.gap6, .gap8 { gap: var(--space-s); }
.wrapc { flex-wrap: wrap; justify-content: center; }
.lead { gap: 0; }
.lead .wrapc { flex-wrap: nowrap; max-width: 100%; }
.lead .wrapc > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dname { margin: 0; overflow-wrap: anywhere; font-size: max(16px, 0.8824rem); line-height: 1.1; }
.amount-block { gap: var(--space-2xs); }
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; gap: var(--space-s); flex-wrap: wrap; }
.ginput { width: 8ch; min-width: 0; max-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; font-size: max(16px, min(1.15rem, 22px)); line-height: 1; }
.unitword { font-size: max(16px, 0.8824rem); line-height: 1.1; }
.units, .chips, .unit-radios { gap: var(--space-xs); flex-wrap: wrap; justify-content: center; max-width: 100%; }
.unit-radios { display: flex; }
.ug { color: var(--text-secondary); }
.chip.on .ug { color: var(--color-on-action); }
.svform { gap: var(--space-s); align-items: center; width: 100%; }
.field { flex: none; }
.sinp { width: 110px; }
.sinp.num { width: 72px; }
.errline { margin: 0; color: var(--text-secondary); min-height: 1.2em; }
.preview { display: flex; flex-direction: column; height: var(--nutrient-card-height); padding: var(--space-box) var(--space-box) 0; border-radius: var(--radius-l); background: var(--color-surface-2); flex: none; width: 100%; align-self: stretch; box-sizing: border-box; }
.khint { margin: 0; text-align: center; }
/* 12px between the keypad and the button under it, as on the weight sheet. The screen's own gap is 2px. */
.actions { flex: none; flex-wrap: wrap; margin-top: calc(var(--space-m) - var(--space-m) / 6); }
.actions :slotted(.btn.primary) { width: auto; flex: 1 1 160px; min-width: 0; }
/* The name, amount and unit stay near the default size so the largest text cannot cover them. */
html.dt-xl .dname { font-size: 22px; line-height: 1.15; overflow-wrap: normal; }
html.dt-xl .ginput { font-size: 22px; }
html.dt-xl .unitword { font-size: 18px; }
html.dt-xl .lead .wrapc { flex-wrap: wrap; }
html.dt-xl .lead .wrapc > span { overflow: visible; text-overflow: clip; white-space: normal; }
/* Type inside the card stays near the default size. Value columns stay narrow
   enough that "Added sugars" stays on one line. */
html.dt-xl .preview :deep(.heads),
html.dt-xl .preview :deep(.list.paired .nrow) { grid-template-columns: minmax(max-content, 1fr) 72px 72px; }
html.dt-xl .preview :deep(.heads.pcts),
html.dt-xl .preview :deep(.list.paired.pcts .nrow) { grid-template-columns: minmax(max-content, 1fr) 64px 40px 72px; }
html.dt-xl .preview :deep(.name) { white-space: nowrap; overflow: visible; text-overflow: clip; }
</style>
