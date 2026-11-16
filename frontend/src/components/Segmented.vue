<script setup lang="ts" generic="T extends string">
import { nextTick } from "vue";

const props = defineProps<{ options: { value: T; label: string; ariaLabel?: string }[]; modelValue: T; label: string; size?: "regular" | "compact" }>();
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
  <div class="seg" :class="{ compact: size === 'compact' }" role="radiogroup" :aria-label="label" :style="{ minWidth: options.length * 44 + 'px' }">
    <button v-for="(o, index) in options" :key="o.value" type="button" role="radio" class="seg-btn t-label"
      :class="{ on: o.value === modelValue }" :aria-checked="o.value === modelValue" :aria-label="o.ariaLabel" :tabindex="tabIndex(o.value, index)"
      @click="emit('update:modelValue', o.value)" @keydown="onKey($event, index)">{{ o.label }}</button>
  </div>
</template>

<style scoped>
/* One segmented control. Each option is the full 44px target; the inset ring draws the
   white pill inside it. Full width by default. size="compact" is for a switch inside a
   card: a 30px face, the hit area stays 44px. It sits to the right of its label, or spans
   the row with class="full". */
.seg {
  display: flex; align-items: stretch; width: 100%; max-width: 100%; box-sizing: border-box;
  border-radius: var(--radius-m); background: var(--btn-bg, var(--color-surface-2));
}
.seg-btn {
  position: relative; flex: 1 1 0; min-width: 44px; white-space: nowrap; min-height: var(--control-hit);
  border-radius: var(--radius-m); padding: var(--space-xs) var(--space-m); color: var(--text-secondary);
}
.seg-btn.on {
  background: var(--color-action); color: var(--color-on-action);
  box-shadow: inset 0 0 0 var(--space-2xs) var(--btn-bg, var(--color-surface-2));
}
.can-hover .seg-btn:not(.on):hover { color: var(--text-primary); }
.compact { width: auto; flex: none; margin-left: auto; align-self: center; }
.compact.full { width: 100%; margin-left: 0; align-self: stretch; }
.compact.full .seg-btn { flex: 1 1 0; }
.compact .seg-btn { min-width: 64px; min-height: var(--control-chip); padding: var(--space-2xs) var(--space-s); }
.compact .seg-btn::after { content: ""; position: absolute; inset: min(0px, calc((100% - var(--control-hit)) / 2)) 0; }
.dt-xl .seg { flex-direction: column; align-items: stretch; }
.dt-xl .seg-btn { flex: none; width: 100%; min-width: 44px; min-height: var(--control-hit); }
.dt-xl .compact { width: 100%; margin-left: 0; }
.dt-xl .compact .seg-btn::after { content: none; }
</style>
