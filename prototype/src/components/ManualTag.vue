<script setup lang="ts">
// S7: small "Manual" tag wherever a manual target is shown. `short` = "M" for tight rows (sr text stays full).
defineProps<{ short?: boolean }>();
</script>
<template>
  <span class="mtag t-capn" :title="short ? 'Manual target (my own number)' : undefined"><span :aria-hidden="short ? 'true' : undefined">{{ short ? "M" : "Manual" }}</span><span v-if="short" class="sr-only">manual target</span></span>
</template>
<style scoped>
.mtag { display: inline-flex; align-items: center; padding: 0 5px; min-height: 16px; border-radius: 5px; border: 1px solid var(--color-border-strong); color: var(--text-secondary); white-space: nowrap; flex: none; letter-spacing: .02em; }
</style>
