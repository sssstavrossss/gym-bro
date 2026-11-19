<script setup lang="ts">
import { computed, watch } from "vue";
import NutrientCard from "./NutrientCard.vue";
import { int } from "../lib/format";
import { dayNutrients, type NutrientSource } from "../lib/nutrients";
import { dayTotals, type DayTotals } from "../state/log";
import { loadNutrientWeek, nutrientWeek } from "../state/nutrientWeek";
import { profile } from "../state/profile";
import type { TargetsResponse } from "../api";

const props = defineProps<{
  target?: TargetsResponse | null;
  totals?: DayTotals | null;
  label?: string;
  entries?: (NutrientSource & { id: string; kcal: number })[];
  /** The day shown. Loads the week average behind the rings' inner circle. */
  date?: string;
}>();
const sources = computed(() => props.entries ?? []);
const nutrientValues = computed(() => dayNutrients(sources.value));
const week = computed(() => (nutrientWeek.date === props.date ? nutrientWeek.average : {}));
// An added, removed, or edited entry changes the week, so reload on each.
const entrySignature = computed(() => sources.value.map((entry) => `${entry.id}:${entry.kcal}:${entry.fat}`).join("|"));
watch([() => props.date, entrySignature], ([date]) => {
  if (date) void loadNutrientWeek(date);
}, { immediate: true });
const target = computed(() => (props.target === undefined ? profile.targets : props.target));
const totals = computed(() => props.totals ?? dayTotals());
</script>

<template>
  <section v-if="!target" class="card macros">
    <span class="t-label">No target on this day</span>
    <p class="t-capn c2 m0">This day is before your first target, so it isn't judged or counted in on-target stats.</p>
    <div class="row nt">
      <span class="t-bodys" data-num>{{ int(totals.kcal) }}</span><span class="t-capn c2">kcal</span>
      <span class="t-bodys" data-num>{{ int(totals.p) }}</span><span class="t-capn c2">P</span>
      <span class="t-bodys" data-num>{{ int(totals.f) }}</span><span class="t-capn c2">F</span>
      <span class="t-bodys" data-num>{{ int(totals.c) }}</span><span class="t-capn c2">C</span>
    </div>
  </section>
  <section v-else class="card macros fit" data-nutrient-card :aria-label="label || 'Today\'s macros'">
    <NutrientCard title="Macros" :goal="target" :eaten="totals" :values="nutrientValues" :entries="sources" :carbs="totals.c" :week="week" :label="label || 'Today\'s macros'" />
  </section>
</template>

<style scoped>
.macros { gap: var(--space-l); }
/* The dot strip ends at the card's bottom edge (its own 12px below the dots). The clip lets the
   dots' 44px hit box reach past that edge, where nothing else is tappable. */
.macros.fit { height: var(--nutrient-card-height); box-sizing: border-box; gap: 0; padding-bottom: 0; clip-path: inset(0 0 -8px 0); }
.m0 { margin: 0; }
.nt { gap: var(--space-xs); align-items: baseline; flex-wrap: wrap; }
.nt .t-capn { margin-right: var(--space-m); }
</style>
