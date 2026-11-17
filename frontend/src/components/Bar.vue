<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  pct: number;
  hit?: boolean;
  over?: boolean;
  /** The end of `pct` that is being added now, drawn brighter after the rest. Ignored once over. */
  added?: number;
}>();
const total = computed(() => Math.min(1, Math.max(0, props.pct)));
const fresh = computed(() => (props.over ? 0 : Math.min(total.value, Math.max(0, props.added ?? 0))));
</script>

<template>
  <div class="bar" :class="{ over }" :role="$attrs['aria-label'] ? 'img' : undefined" :aria-hidden="$attrs['aria-label'] ? undefined : 'true'">
    <template v-if="fresh > 0">
      <div v-if="total > fresh" class="fill" :style="{ width: `${(total - fresh) * 100}%` }" />
      <div class="fill add" data-added :style="{ width: `max(3px, ${fresh * 100}%)` }" />
    </template>
    <div v-else class="fill" :class="{ hit: hit && !over }" :style="{ width: `max(4px, ${total * 100}%)` }" />
  </div>
</template>

<style scoped>
.bar { display: flex; gap: 1px; height: 4px; border-radius: 2px; background: var(--color-track); overflow: hidden; width: 100%; flex: none; }
.fill { height: 100%; border-radius: 2px; background: var(--color-progress); flex: none; }
.fill.hit { background: var(--color-hit); }
.fill.add { background: var(--text-primary); }
.bar.over { height: 6px; border-radius: 3px; }
.bar.over .fill { background: repeating-linear-gradient(-45deg, var(--over-mark) 0 3px, var(--over-gap) 3px 6px); }
</style>
