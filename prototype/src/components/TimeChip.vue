<script setup lang="ts">
// Entry time: "Now" by default today; tap to pick a time (native picker). On a past day there is no default:
// the chip reads "Pick a time" until one is chosen (approved 24 Oct 2026).
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { dayMonth } from "../lib/dates";
import { nowHM } from "../lib/time";
import { today } from "../store";
const props = defineProps<{ modelValue: string | null; date: string; allowNow?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();
const el = ref<HTMLInputElement | null>(null);
const past = computed(() => props.date !== today);
const needed = computed(() => past.value && !props.modelValue);
const label = computed(() => {
  const t = props.modelValue ?? (past.value ? "Pick a time" : props.allowNow !== false ? "Now" : nowHM());
  return past.value ? `${dayMonth(props.date)} · ${t}` : t;
});
// The transparent native input sits on top of the chip, so a tap opens the OS time wheel (iOS) directly;
// on desktop browsers we also call showPicker().
function prime() { const i = el.value; if (i && !i.value && !past.value) i.value = props.modelValue ?? nowHM(); }
function pick() {
  prime();
  try { el.value?.showPicker(); } catch { /* not supported: native focus is enough */ }
}
defineExpose({ open: () => { el.value?.focus(); pick(); } });
function change(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  emit("update:modelValue", v || null);
}
</script>

<template>
  <span class="tchip-wrap">
    <span class="tchip t-label" :class="{ set: modelValue || past, need: needed }">
      <Icon name="clock" :size="14" :sw="2.2" />
      <span>{{ label }}</span>
      <input ref="el" class="tinput" type="time" :aria-label="`Time: ${label}. Change time`" :value="modelValue ?? ''" @pointerdown="prime" @click="pick" @change="change" />
    </span>
    <button v-if="modelValue && !past && allowNow !== false" type="button" class="now t-capn c2" @click="emit('update:modelValue', null)">Now</button>
  </span>
</template>

<style scoped>
.tchip-wrap { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.tchip { position: relative; min-height: 32px; padding: 0 12px; border-radius: 16px; display: inline-flex; align-items: center; gap: 6px; background: var(--color-surface-2); color: var(--text-primary); white-space: nowrap; }
.tchip.need { box-shadow: none; outline: 1.5px dashed var(--text-primary); outline-offset: -1.5px; background: transparent; }
.tchip.set { box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
.tinput { position: absolute; inset: -6px 0; width: 100%; height: calc(100% + 12px); opacity: 0; border: 0; padding: 0; margin: 0; cursor: pointer; font-size: 16px; }
.tchip:focus-within { outline: 2px solid var(--color-action); outline-offset: 2px; }
.now { min-height: 32px; padding: 0 6px; position: relative; }
.now::after { content: ""; position: absolute; inset: -6px -4px; }
.can-hover .tchip:hover { background: #303036; }
</style>
