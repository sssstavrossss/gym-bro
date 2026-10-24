<script setup lang="ts" generic="T extends string">
import { nextTick } from "vue";

const props = defineProps<{ options: { value: T; label: string }[]; modelValue: T; label: string }>();
const emit = defineEmits<{ "update:modelValue": [T] }>();

function tabIndex(value: T, index: number) {
  if (value === props.modelValue) return 0;
  const selected = props.options.some((option) => option.value === props.modelValue);
  return !selected && index === 0 ? 0 : -1;
}

async function onKey(event: KeyboardEvent, index: number) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
  if (!forward && !back) return;
  event.preventDefault();
  const delta = forward ? 1 : -1;
  const next = (index + delta + props.options.length) % props.options.length;
  emit("update:modelValue", props.options[next].value);
  await nextTick();
  const group = (event.currentTarget as HTMLElement).closest("[role='radiogroup']");
  group?.querySelectorAll<HTMLButtonElement>("[role='radio']")[next]?.focus();
}
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label" :style="{ minWidth: options.length * 44 + 8 + 'px' }">
    <button v-for="(o, index) in options" :key="o.value" type="button" role="radio" class="seg-btn t-label"
      :class="{ on: o.value === modelValue }" :aria-checked="o.value === modelValue" :tabindex="tabIndex(o.value, index)"
      @click="emit('update:modelValue', o.value)" @keydown="onKey($event, index)">{{ o.label }}</button>
  </div>
</template>

<style scoped>
.seg {
  display: flex; align-items: stretch; gap: 2px; padding: 3px; width: 100%; max-width: 100%;
  box-sizing: border-box; border-radius: 12px; background: var(--color-surface-2);
}
.seg-btn {
  position: relative; flex: 1 1 0; min-width: max(44px, max-content); min-height: 44px;
  border-radius: 9px; padding: 4px 12px; color: var(--text-secondary);
}
.seg-btn.on { background: var(--color-action); color: var(--color-on-action); }
.dt-xl .seg { flex-direction: column; align-items: stretch; }
.dt-xl .seg-btn { flex: none; width: 100%; white-space: nowrap; min-width: max(44px, max-content); min-height: 44px; }
</style>
