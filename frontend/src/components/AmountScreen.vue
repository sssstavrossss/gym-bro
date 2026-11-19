<script setup lang="ts">
import { ref } from "vue";
import Keypad from "./Keypad.vue";
import { markWholeSelection } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";

/**
 * The amount screen's layout: a name, the amount in large type with its units and quick
 * amounts, the nutrient card, the keypad and the buttons. Logging a food, adding an ingredient
 * and logging a recipe all use it. The state stays with the screen that shows it.
 */
export interface AmountUnit {
  id: string;
  label: string;
  /** Beside the label in a lighter colour: " · 150 g". */
  detail?: string;
  /** Read out after the label only. */
  spoken?: string;
  on: boolean;
}
export interface AmountChip {
  id: string;
  label: string;
}

defineProps<{
  title: string;
  amountText: string;
  /** The field's name for a screen reader: "Amount in g". */
  fieldLabel: string;
  unitWord: string;
  units: readonly AmountUnit[];
  unitsLabel: string;
  chips: readonly AmountChip[];
}>();
const emit = defineEmits<{
  input: [event: Event];
  focus: [event: FocusEvent];
  submit: [];
  unit: [id: string];
  chip: [id: string];
  key: [key: string];
}>();

const field = ref<HTMLInputElement | null>(null);
defineExpose({ field });
</script>

<template>
  <div class="amount-screen">
    <div class="col center lead">
      <h3 class="t-head dname">{{ title }}</h3>
      <span class="row gap6 t-label c2 wrapc meta"><slot name="meta" /></span>
      <slot name="notice" />
    </div>
    <div class="col center amount-block">
      <div class="base">
        <input ref="field" v-autofocus :value="amountText" data-replace="1" class="t-dl num ginput" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="fieldLabel"
          @beforeinput="markWholeSelection" @focus="emit('focus', $event)" @input="emit('input', $event)" @keydown.enter.prevent="emit('submit')" />
        <span class="t-head c2 unitword">{{ unitWord }}</span>
      </div>
      <slot name="subline" />
      <div v-if="units.length || $slots['units-end']" class="row units">
        <div v-if="units.length" class="unit-radios" role="radiogroup" :aria-label="unitsLabel">
          <button v-for="choice in units" :key="choice.id" type="button" role="radio" class="chip t-label" :class="{ on: choice.on }" :aria-checked="choice.on" @click="emit('unit', choice.id)">
            {{ choice.label }}<span v-if="choice.detail" class="ug">{{ choice.detail }}</span><span v-if="choice.spoken" class="sr-only">{{ choice.spoken }}</span>
          </button>
        </div>
        <slot name="units-end" />
      </div>
      <slot name="extra" />
      <div class="row gap8 chips">
        <button v-for="chip in chips" :key="chip.id" type="button" class="chip t-label" @click="emit('chip', chip.id)">{{ chip.label }}</button>
      </div>
    </div>
    <div class="preview" aria-live="polite">
      <slot name="card" />
    </div>
    <div class="grow" />
    <slot name="alerts" />
    <Keypad v-if="!keyboardEntry" @key="emit('key', $event)" />
    <!-- With a keyboard instead of the keypad: what Enter and Esc do. -->
    <p v-else class="t-capn c3 khint keyhint"><slot name="hint" /></p>
    <slot name="note" />
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
.lead .meta { flex-wrap: nowrap; max-width: 100%; }
.dname { margin: 0; overflow-wrap: anywhere; font-size: max(16px, 0.8824rem); line-height: 1.1; }
.amount-block { gap: var(--space-2xs); }
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; gap: var(--space-s); flex-wrap: wrap; }
.ginput { width: 8ch; min-width: 0; max-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; font-size: max(16px, min(1.15rem, 22px)); line-height: 1; }
.unitword { font-size: max(16px, 0.8824rem); line-height: 1.1; }
.units, .chips, .unit-radios { gap: var(--space-xs); flex-wrap: wrap; justify-content: center; max-width: 100%; }
.unit-radios { display: flex; }
.ug { color: var(--text-secondary); }
.chip.on .ug { color: var(--color-on-action); }
.preview { display: flex; flex-direction: column; height: var(--nutrient-card-height); padding: var(--space-box) var(--space-box) 0; border-radius: var(--radius-l); background: var(--color-surface-2); flex: none; width: 100%; align-self: stretch; box-sizing: border-box; }
.khint { margin: 0; text-align: center; }
/* 12px between the keypad and the button under it, as on the weight sheet. The screen's own gap is 2px. */
.actions { flex: none; flex-wrap: wrap; margin-top: calc(var(--space-m) - var(--space-m) / 6); }
/* Copy, Delete and Save share one row: each keeps 12px either side of its label, and Save takes
   the rest at its own text width. Only when even that doesn't fit (very narrow, large text) does Save wrap. */
.actions :slotted(.btn) { padding-inline: var(--space-m); }
.actions :slotted(.btn.primary) { width: auto; flex: 1 1 auto; min-width: 0; }
/* The name, amount and unit stay near the default size so the largest text cannot cover them. */
html.dt-xl .dname { font-size: 22px; line-height: 1.15; overflow-wrap: normal; }
html.dt-xl .ginput { font-size: 22px; }
html.dt-xl .unitword { font-size: 18px; }
html.dt-xl .lead .meta { flex-wrap: wrap; }
/* Type inside the card stays near the default size. Value columns stay narrow
   enough that "Added sugars" stays on one line. */
html.dt-xl .preview :deep(.heads),
html.dt-xl .preview :deep(.list.paired .nrow) { grid-template-columns: minmax(max-content, 1fr) 72px 72px; }
html.dt-xl .preview :deep(.heads.pcts),
html.dt-xl .preview :deep(.list.paired.pcts .nrow) { grid-template-columns: minmax(max-content, 1fr) 64px 40px 72px; }
html.dt-xl .preview :deep(.name) { white-space: nowrap; overflow: visible; text-overflow: clip; }
</style>
