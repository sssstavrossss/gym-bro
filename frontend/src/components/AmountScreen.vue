<script setup lang="ts">
import { ref } from "vue";
import Keypad from "./Keypad.vue";
import { markWholeSelection } from "../lib/quickEntry";
import { keyboardEntry } from "../lib/viewport";

/**
 * The amount screen's layout. The page starts at the top: the name, a box with the amount in large
 * type and its units, and the nutrient card. Under it, a tray stays at the bottom of the sheet like
 * the phone's own keyboard: the quick amounts, the keypad and the buttons. When the page is taller
 * than the room above the tray (a small phone, large text), the page scrolls and the tray stays.
 * Logging a food, adding an ingredient and logging a recipe all use it. The state stays with the
 * screen that shows it.
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
    <div class="page">
      <div class="col lead">
        <h3 class="t-head dname">{{ title }}</h3>
        <span class="row gap6 t-label c2 meta"><slot name="meta" /></span>
        <slot name="notice" />
      </div>
      <!-- The number and its unit, then the units: beside them when they fit, on their own line when not. -->
      <div class="amount-box" data-amount-box>
        <div class="base">
          <!-- The mirror sizes the field to its digits, so the unit sits right after the number. -->
          <span class="autosize">
            <span class="mirror fig" aria-hidden="true">{{ amountText || "0" }}</span>
            <input ref="field" v-autofocus :value="amountText" data-replace="1" class="fig ginput" size="1" :inputmode="keyboardEntry ? 'decimal' : 'none'" autocomplete="off" :aria-label="fieldLabel"
              @beforeinput="markWholeSelection" @focus="emit('focus', $event)" @input="emit('input', $event)" @keydown.enter.prevent="emit('submit')" />
          </span>
          <span class="t-head c2 unitword">{{ unitWord }}</span>
          <span class="t-capn c2 subline"><slot name="subline" /></span>
        </div>
        <div v-if="units.length || $slots['units-end']" class="row units">
          <div v-if="units.length" class="unit-radios" role="radiogroup" :aria-label="unitsLabel">
            <button v-for="choice in units" :key="choice.id" type="button" role="radio" class="chip t-label" :class="{ on: choice.on }" :aria-checked="choice.on" @click="emit('unit', choice.id)">
              {{ choice.label }}<span v-if="choice.detail" class="ug">{{ choice.detail }}</span><span v-if="choice.spoken" class="sr-only">{{ choice.spoken }}</span>
            </button>
          </div>
          <slot name="units-end" />
        </div>
      </div>
      <slot name="extra" />
      <div class="preview" aria-live="polite">
        <slot name="card" />
      </div>
    </div>
    <div class="tray" data-amount-tray data-toast-floor>
      <slot name="alerts" />
      <!-- One line that scrolls sideways when long serving names or large text don't fit. -->
      <div v-if="chips.length" class="row chips" role="group" aria-label="Quick amounts">
        <button v-for="chip in chips" :key="chip.id" type="button" class="chip t-label" @click="emit('chip', chip.id)">{{ chip.label }}</button>
      </div>
      <Keypad v-if="!keyboardEntry" @key="emit('key', $event)" />
      <!-- With a keyboard instead of the keypad: what Enter and Esc do. -->
      <p v-else class="t-capn c3 khint keyhint"><slot name="hint" /></p>
      <slot name="note" />
      <div class="row gap8 actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Its own class: a parent's scoped `.body` would also reach this root and change the gap. */
.amount-screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.page { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: var(--space-s); padding-bottom: var(--space-m); }
/* The same line and spacing as a sheet's footer (the Weight sheet's keypad). */
.tray { flex: none; display: flex; flex-direction: column; gap: var(--space-m); padding-top: var(--space-m); border-top: 1px solid var(--color-border); }
.gap6, .gap8 { gap: var(--space-s); }
.lead { gap: 0; }
.lead .meta { flex-wrap: nowrap; max-width: 100%; }
.dname { margin: 0; overflow-wrap: anywhere; font-size: max(16px, 0.8824rem); line-height: 1.1; }

.amount-box {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  column-gap: var(--space-s); row-gap: var(--space-xs);
  padding: var(--space-s) var(--space-m); border-radius: var(--radius-l); background: var(--color-surface-2);
  box-shadow: var(--d-sunk);
}
.base { min-width: 0; max-width: 100%; display: flex; align-items: baseline; column-gap: var(--space-xs); flex-wrap: wrap; }
.autosize { display: inline-grid; min-height: 44px; min-width: 0; max-width: 100%; }
.autosize > * { grid-area: 1 / 1; }
/* The Weight sheet's big number, a little smaller so the name and card keep their room. */
.fig { font-size: min(2.6rem, 46px); line-height: 1.1; font-weight: 700; letter-spacing: -0.03em; }
.mirror { visibility: hidden; white-space: pre; padding-right: 0.08em; }
.ginput { width: 0; min-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; caret-color: var(--text-primary); }
.unitword { font-size: max(16px, 0.8824rem); line-height: 1.1; }
.subline:empty { display: none; }
/* Never squeezed beside the number: the whole row moves under it instead. */
.units { flex: 0 0 auto; max-width: 100%; gap: var(--space-xs); flex-wrap: wrap; }
.unit-radios { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
.ug { color: var(--text-secondary); }
.chip.on .ug { color: var(--color-on-action); }

.preview { display: flex; flex-direction: column; height: var(--nutrient-card-height); padding: var(--space-box) var(--space-box) 0; border-radius: var(--radius-l); background: var(--color-surface-2); flex: none; width: 100%; align-self: stretch; box-sizing: border-box; box-shadow: var(--d-edge); }

/* Edge to edge, so a chip that doesn't fit shows it scrolls. Equal widths when they all fit.
   `.tray` outranks the large-text rule that lets every `.row` wrap. */
.tray .chips {
  flex-wrap: nowrap; gap: var(--space-xs); overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  margin-inline: calc(-1 * var(--space-screen)); padding-inline: var(--space-screen);
}
.chips::-webkit-scrollbar { display: none; }
.chips .chip { flex: 1 0 auto; justify-content: center; white-space: nowrap; }
.khint { margin: 0; text-align: center; }
.actions { flex: none; flex-wrap: wrap; }
/* Copy, Delete and Save share one row: each keeps 12px either side of its label, and Save takes
   the rest at its own text width. Only when even that doesn't fit (very narrow, large text) does Save wrap. */
.actions :slotted(.btn) { padding-inline: var(--space-m); }
.actions :slotted(.btn.primary) { width: auto; flex: 1 1 auto; min-width: 0; }
/* The name, amount and unit stay near the default size so the largest text cannot cover them. */
html.dt-xl .dname { font-size: 22px; line-height: 1.15; overflow-wrap: normal; }
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
