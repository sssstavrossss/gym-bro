<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { dayMonth, todayIso } from "../lib/dates";

const props = withDefaults(defineProps<{ modelValue: string | null; date: string; today?: string; allowNow?: boolean }>(), {
  allowNow: true,
});
const emit = defineEmits<{ "update:modelValue": [string | null] }>();
const el = ref<HTMLInputElement | null>(null);
const past = computed(() => props.date !== (props.today || todayIso()));
const needed = computed(() => past.value && !props.modelValue);
const label = computed(() => {
  const time = props.modelValue ?? (past.value || props.allowNow === false ? "Pick a time" : "Now");
  return past.value ? `${dayMonth(props.date)} · ${time}` : time;
});

// The input covers the chip, so the tap focuses it in the same gesture.
// A later focus() would not raise the iOS keyboard. Font size stays at 16px.
function prime() {
  const input = el.value;
  if (input && !input.value && !past.value) input.value = props.modelValue ?? nowHM();
}
function arm() {
  prime();
  // The tap lands on this input. Focusing it here, still inside pointerdown,
  // is what raises the keyboard on iOS Safari. showPicker on click is too late.
  el.value?.focus({ preventScroll: true });
}
function pick() {
  prime();
  const input = el.value;
  if (!input) return;
  input.focus({ preventScroll: true });
  try { input.showPicker(); } catch { /* focus already opened the control */ }
  if (document.activeElement !== input) input.focus({ preventScroll: true });
}
function nowHM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
function change(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", value || null);
}
</script>

<template>
  <span class="tchip-wrap">
    <span class="tchip t-label" :class="{ set: modelValue, need: needed }">
      <Icon name="clock" :size="14" :sw="2.2" />
      <span>{{ label }}</span>
      <input ref="el" class="tinput" type="time" :aria-label="`Time: ${label}. Change time`" :value="modelValue ?? ''" @pointerdown="arm" @click="pick" @change="change" />
    </span>
    <button v-if="modelValue && !past && allowNow" type="button" class="now t-capn c2" @click="emit('update:modelValue', null)">Now</button>
  </span>
</template>

<style scoped>
.tchip-wrap { position: relative; display: inline-flex; align-items: center; gap: var(--space-gap); max-width: 100%; min-height: var(--control-hit); }
.tchip { position: relative; height: var(--control-s); min-height: var(--control-s); padding: 0 var(--space-gap); border-radius: calc(var(--control-s) / 2); display: inline-flex; align-items: center; gap: calc(var(--space-gap) / 2); background: var(--color-surface-2); color: var(--text-primary); }
.tchip.need { box-shadow: none; outline: 1.5px dashed var(--text-primary); outline-offset: -1.5px; background: transparent; }
.tchip.set { box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
/* opacity stays above 0 so WebKit will focus the control. It is still invisible. */
.tinput { position: absolute; left: 0; right: 0; top: 50%; width: 100%; height: var(--control-hit); transform: translateY(-50%); opacity: 0.02; border: 0; padding: 0; margin: 0; cursor: pointer; font-size: 16px; color: transparent; }
.tchip:focus-within { outline: 2px solid var(--color-action); outline-offset: 2px; }
.now { min-height: var(--control-hit); min-width: var(--control-hit); padding: 0 var(--space-gap); }
</style>
