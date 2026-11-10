<script setup lang="ts">
defineProps<{ short?: boolean }>();
</script>

<template>
  <span class="mtag t-capn" role="img" title="Manual target (my own number)" aria-label="Manual target, my own number">
    <span aria-hidden="true">{{ short ? "M" : "Manual" }}</span>
  </span>
</template>

<style scoped>
.mtag {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; min-height: 16px; padding: 0 4px;
  border-radius: 5px; border: 1px solid var(--color-border-strong);
  color: var(--text-secondary); white-space: nowrap; flex: none;
}
</style>
