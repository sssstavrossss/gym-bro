<script setup lang="ts" generic="T extends string">
defineProps<{ options: { value: T; label: string }[]; modelValue: T; height?: number }>();
defineEmits<{ "update:modelValue": [T] }>();
</script>

<template>
  <div class="seg" :style="{ minHeight: (height ?? 36) + 'px' }" role="radiogroup">
    <button v-for="o in options" :key="o.value" type="button" role="radio" class="seg-btn t-label"
      :class="{ on: o.value === modelValue }" :aria-checked="o.value === modelValue"
      @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
  </div>
</template>

<style scoped>
.seg { display: flex; padding: 3px; border-radius: 10px; background: var(--color-surface-2); gap: 0; }
.seg-btn { position: relative; flex: 1 1 0; border-radius: 8px; padding: 2px 6px; color: var(--text-secondary); transition: background .15s, color .15s; }
.seg-btn::after { content: ""; position: absolute; inset: min(0px, calc((100% - 44px) / 2)) 0; } /* 44 pt target */
.seg-btn.on { background: var(--color-action); color: var(--color-on-action); }
/* Dynamic Type: options stack at AX sizes */
.dt-xl .seg { flex-direction: column; }
.dt-xl .seg-btn { min-height: 44px; flex: none; }
</style>
