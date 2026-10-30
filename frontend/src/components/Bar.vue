<script setup lang="ts">
const props = defineProps<{ pct: number; hit?: boolean; over?: boolean }>();
void props;
</script>

<template>
  <div class="bar" :class="{ over }" :role="$attrs['aria-label'] ? 'img' : undefined" :aria-hidden="$attrs['aria-label'] ? undefined : 'true'">
    <div class="fill" :class="{ hit: hit && !over }" :style="{ width: `max(4px, ${Math.min(1, Math.max(0, pct)) * 100}%)` }" />
  </div>
</template>

<style scoped>
.bar { height: 4px; border-radius: 2px; background: var(--color-track); overflow: hidden; width: 100%; flex: none; }
.fill { height: 100%; border-radius: 2px; background: var(--color-progress); }
.fill.hit { background: var(--color-hit); }
.bar.over { height: 6px; border-radius: 3px; }
.bar.over .fill { background: repeating-linear-gradient(-45deg, #d6d6da 0 3px, #55555c 3px 6px); }
</style>
