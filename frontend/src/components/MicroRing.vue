<script setup lang="ts">
import { computed } from "vue";
import { MICRO_LEVEL_NAMES, microCoverage, type NutrientMap } from "../lib/nutrients";

/**
 * A small ring on a food search row that fills by quarters with how much of the
 * nutrient panel the food knows: empty for none, full for all.
 */
const props = defineProps<{ nutrients?: NutrientMap | null }>();

const R = 5;
const C = 2 * Math.PI * R;
const coverage = computed(() => microCoverage(props.nutrients));
const label = computed(() => {
  const c = coverage.value;
  return c ? `Micronutrients: ${MICRO_LEVEL_NAMES[c.level]} (${c.known} of ${c.total})` : "";
});
const fill = computed(() => (coverage.value ? coverage.value.level / 4 : 0));
</script>

<template>
  <span v-if="coverage" class="micro" role="img" :aria-label="label" :title="label" :data-micro="MICRO_LEVEL_NAMES[coverage.level]">
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" :r="R" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="2" />
      <circle
        v-if="fill > 0"
        cx="7"
        cy="7"
        :r="R"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        :stroke-dasharray="`${C * fill} ${C}`"
        :stroke-linecap="fill < 1 ? 'round' : 'butt'"
        transform="rotate(-90 7 7)"
      />
    </svg>
  </span>
</template>

<style scoped>
.micro { display: inline-flex; flex: none; color: var(--text-secondary); }
.micro svg { display: block; }
</style>
