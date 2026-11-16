<script setup lang="ts">
/** "+12 over" beside a bar that went past its target or limit. */
defineProps<{ text: string }>();
</script>

<template>
  <span class="overtag t-capn">{{ text }}</span>
</template>

<style scoped>
.overtag { align-self: center; padding: 1px var(--space-s); border-radius: var(--radius-xs); border: 1px dashed var(--text-secondary); color: var(--text-secondary); margin-left: var(--space-2xs); white-space: nowrap; }
</style>
