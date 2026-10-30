<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { todayIso } from "../lib/dates";

const props = defineProps<{ modelValue: string | null; date: string; allowNow?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();
const el = ref<HTMLInputElement | null>(null);
const past = computed(() => props.date !== todayIso());
const label = computed(() => props.modelValue ?? (props.allowNow !== false ? "Now" : "Pick a time"));

function prime() {
  const input = el.value;
  if (input && !input.value && !past.value) input.value = props.modelValue ?? nowHM();
}
function pick() {
  prime();
  try { el.value?.showPicker(); } catch { /* the native control still opens on focus */ }
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
    <span class="tchip t-label" :class="{ set: modelValue }">
      <Icon name="clock" :size="14" :sw="2.2" />
      <span>{{ label }}</span>
      <input ref="el" class="tinput" type="time" :aria-label="`Time: ${label}. Change time`" :value="modelValue ?? ''" @pointerdown="prime" @click="pick" @change="change" />
    </span>
    <button v-if="modelValue && allowNow !== false" type="button" class="now t-capn c2" @click="emit('update:modelValue', null)">Now</button>
  </span>
</template>

<style scoped>
.tchip-wrap { position: relative; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; }
.tchip { position: relative; min-height: 44px; padding: 0 12px; border-radius: 22px; display: inline-flex; align-items: center; gap: 6px; background: var(--color-surface-2); color: var(--text-primary); }
.tchip.set { box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
.tinput { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; border: 0; padding: 0; margin: 0; cursor: pointer; font-size: 16px; }
.tchip:focus-within { outline: 2px solid var(--color-action); outline-offset: 2px; }
.now { min-height: 44px; min-width: 44px; padding: 0 8px; }
</style>
