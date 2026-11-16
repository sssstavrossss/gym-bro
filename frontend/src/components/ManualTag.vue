<script setup lang="ts">
defineProps<{ short?: boolean }>();
</script>

<template>
  <span class="tag mtag t-capn" role="img" title="Manual target (my own number)" aria-label="Manual target, my own number">
    <span aria-hidden="true">{{ short ? "M" : "Manual" }}</span>
  </span>
</template>

<style scoped>
/* The shared .tag, a little tighter so it fits inside a number row. */
.mtag { justify-content: center; min-width: 16px; min-height: 16px; padding: 0 var(--space-xs); }
</style>
