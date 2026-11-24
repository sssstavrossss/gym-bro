<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { dayMonth, todayIso } from "../lib/dates";

const props = withDefaults(defineProps<{ modelValue: string | null; date: string; today?: string; allowNow?: boolean }>(), {
  allowNow: true,
});
const emit = defineEmits<{ "update:modelValue": [string | null] }>();
const el = ref<HTMLInputElement | null>(null);
const otherDay = computed(() => props.date !== (props.today || todayIso()));
const needed = computed(() => otherDay.value && !props.modelValue);
const label = computed(() => {
  const time = props.modelValue ?? (otherDay.value || props.allowNow === false ? "Pick a time" : "Now");
  return otherDay.value ? `${dayMonth(props.date)} · ${time}` : time;
});

// The input covers the chip, so the tap lands on the native control and opens it.
// Font size stays at 16px so iOS doesn't zoom.
function prime() {
  const input = el.value;
  if (input && !input.value && !otherDay.value) input.value = props.modelValue ?? nowHM();
}
const isTouch = (type: string) => type === "touch" || type === "pen";
/** How the last press began: "mouse", "touch" or "pen". Empty for a keyboard click. */
let pointer = "";
function arm(event: PointerEvent) {
  pointer = event.pointerType;
  prime();
  // On a phone the tap opens the picker when the finger lifts. Focusing on touch-down opened
  // it under the finger, and iOS 26 then took the lift as a tap outside and closed it again.
  if (!isTouch(pointer)) el.value?.focus({ preventScroll: true });
}
function pick() {
  const touched = isTouch(pointer);
  pointer = "";
  prime();
  const input = el.value;
  if (!input) return;
  // The tap already opened the picker. Asking again with showPicker, which iOS 26 honours,
  // closes it. If the tap didn't focus the field, focusing it here (still in the tap) opens it.
  if (touched) {
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    return;
  }
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
      <input ref="el" class="tinput" type="time" data-no-autofocus :aria-label="`Time: ${label}. Change time`" :value="modelValue ?? ''" @pointerdown="arm" @click="pick" @change="change" />
    </span>
    <button v-if="modelValue && !otherDay && allowNow" type="button" class="now t-capn c2" @click="emit('update:modelValue', null)">Now</button>
  </span>
</template>

<style scoped>
.tchip-wrap { position: relative; display: inline-flex; align-items: center; gap: var(--space-m); max-width: 100%; min-height: var(--control-hit); }
.tchip { position: relative; height: var(--control-s); min-height: var(--control-s); padding: 0 var(--space-m); border-radius: calc(var(--control-s) / 2); display: inline-flex; align-items: center; gap: var(--space-s); background: var(--color-surface-2); color: var(--text-primary); box-shadow: var(--d-control); }
.tchip.need { box-shadow: none; outline: 1.5px dashed var(--text-primary); outline-offset: -1.5px; background: transparent; }
.tchip.set { box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
/* opacity stays above 0 so WebKit will focus the control. It is still invisible. */
.tinput { position: absolute; left: 0; right: 0; top: 50%; width: 100%; height: var(--control-hit); transform: translateY(-50%); opacity: 0.02; border: 0; padding: 0; margin: 0; cursor: pointer; font-size: 16px; color: transparent; }
/* Chrome draws its own clock icon inside the control; at 2% opacity it still showed as a ghost. */
.tinput::-webkit-calendar-picker-indicator { opacity: 0; }
.tchip:focus-within { outline: 2px solid var(--color-action); outline-offset: 2px; }
.now { min-height: var(--control-hit); min-width: var(--control-hit); padding: 0 var(--space-m); }
</style>
