<script setup lang="ts">
// Progress bar: grey while under, white when on target, hatched outline when over. Never red.
const props = defineProps<{ pct: number; hit?: boolean; over?: boolean; width?: number }>();
void props;
</script>

<template>
  <div class="bar" :class="{ over }" :role="$attrs['aria-label'] ? 'img' : undefined" :aria-hidden="$attrs['aria-label'] ? undefined : 'true'" :style="width ? { width: width + 'px' } : undefined">
    <div class="fill" :class="{ hit: hit && !over }" :style="{ width: `max(4px, ${Math.min(1, Math.max(0, pct)) * 100}%)` }" />
  </div>
</template>

<style scoped>
.bar { height: 4px; border-radius: 2px; background: var(--color-track); overflow: hidden; width: 100%; flex: none; }
.fill { height: 100%; border-radius: 2px; background: var(--color-progress); transition: width .35s ease; }
.fill.hit { background: var(--color-hit); }
/* over: diagonal hatch in light grey — distinct from "hit" without using colour */
.bar.over { height: 6px; border-radius: 3px; }
.bar.over .fill { background: repeating-linear-gradient(-45deg, #d6d6da 0 3px, #55555c 3px 6px); }
</style>
