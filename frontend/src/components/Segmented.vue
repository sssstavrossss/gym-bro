<script setup lang="ts" generic="T extends string">
withDefaults(defineProps<{ options: { value: T; label: string }[]; modelValue: T; height?: number }>(), { height: 44 });
defineEmits<{ "update:modelValue": [T] }>();
</script>

<template>
  <div class="seg" :style="{ height: height + 'px' }" role="tablist">
    <button v-for="o in options" :key="o.value" type="button" role="tab" class="seg-btn t-label"
      :class="{ on: o.value === modelValue }" :aria-selected="o.value === modelValue"
      @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
  </div>
</template>

<style scoped>
.seg { display: flex; padding: 3px; border-radius: 12px; background: var(--color-surface-2); gap: 0; }
.seg-btn { flex: 1 1 0; min-height: 38px; border-radius: 9px; color: var(--text-secondary); }
.seg-btn.on { background: var(--color-action); color: var(--color-on-action); }
</style>
