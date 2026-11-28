<script setup lang="ts">
import { dialSpec, type DialId } from "../lib/dial";
import { parseDecimal } from "../lib/numbers";
import { keyboardEntry } from "../lib/viewport";
import { openDial } from "../ui";

/**
 * A number in a form (Profile, Setup, the food editor). With a mouse or trackpad it is a text field; on a touch screen it
 * is a button that opens the number wheel (README, *Picking a number*), so the phone's own number pad never comes up.
 * The class the form gives it lands on either one. `commit` comes when a value is done: the field's blur, or the wheel's ✓.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** The wheel's preset. */
    dial: DialId;
    /** What the wheel and a screen reader call it: "Birth year", "Height in centimetres". */
    label: string;
    placeholder?: string;
    hint?: string;
    min?: number;
    max?: number;
    /** The wheel's unit word, when it isn't the preset's. */
    unit?: string;
    live?: (value: number) => string;
    /** How a picked number goes into the form, when not as it reads ("2.0" for protein). */
    format?: (value: number) => string;
    inputmode?: "decimal" | "numeric";
    maxlength?: number;
    autofocus?: boolean;
    invalid?: boolean;
  }>(),
  { placeholder: "", hint: undefined, min: undefined, max: undefined, unit: undefined, live: undefined, format: undefined, inputmode: "decimal", maxlength: undefined, autofocus: false, invalid: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string]; commit: [] }>();

function pick(event: MouseEvent) {
  const spec = dialSpec(props.dial, {
    label: props.label,
    hint: props.hint,
    value: parseDecimal(props.modelValue),
    min: props.min,
    max: props.max,
    unit: props.unit,
    live: props.live,
  });
  openDial(spec, event.currentTarget as Element, (value) => {
    emit("update:modelValue", props.format ? props.format(value) : String(value));
    emit("commit");
  });
}
</script>

<template>
  <input
    v-if="keyboardEntry" v-autofocus="autofocus" :value="modelValue" type="text" :inputmode="inputmode" :maxlength="maxlength" autocomplete="off"
    :aria-label="label" :placeholder="placeholder" :aria-invalid="invalid || undefined"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @blur="emit('commit')"
  />
  <button
    v-else type="button" class="npick" :class="{ hinted: !modelValue }" :aria-label="`${label}, ${modelValue || 'not set'}, change`" :aria-invalid="invalid || undefined"
    data-number-pick @click="pick"
  >{{ modelValue || placeholder || "–" }}</button>
</template>

<style scoped>
/* Takes the field's place and its type; the form's own class sets the width and alignment. */
.npick { min-height: 44px; color: var(--text-primary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.npick.hinted { color: var(--text-tertiary); }
.npick:active { opacity: .7; }
</style>
