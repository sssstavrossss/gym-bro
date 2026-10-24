<script setup lang="ts">
defineProps<{ w?: string; h?: number; r?: number }>();
</script>
<template><span class="sk" :style="{ width: w ?? '100%', height: (h ?? 14) + 'px', borderRadius: (r ?? 6) + 'px' }" aria-hidden="true" /></template>
<style scoped>
.sk { display: block; background: linear-gradient(90deg, #1f1f22 0%, #2a2a2f 50%, #1f1f22 100%); background-size: 200% 100%; animation: sk 1.2s ease-in-out infinite; }
@keyframes sk { from { background-position: 100% 0; } to { background-position: -100% 0; } }
</style>
