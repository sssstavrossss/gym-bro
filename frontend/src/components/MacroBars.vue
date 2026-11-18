<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MacroRows from "./MacroRows.vue";
import NutrientPanelSet from "./NutrientPanelSet.vue";
import SwipePanels from "./SwipePanels.vue";
import { followPage } from "../lib/cardPages";
import { int } from "../lib/format";
import { fatLimitsOf } from "../lib/nutrientCards";
import { dayNutrients, panelsForSize, type NutrientSource } from "../lib/nutrients";
import { dayTotals, type DayTotals } from "../state/log";
import { cardPages } from "../state/cardPages";
import { loadNutrientWeek, nutrientWeek } from "../state/nutrientWeek";
import { nutrientPerson, profile } from "../state/profile";
import { openCardPages } from "../ui";
import type { TargetsResponse } from "../api";

const props = defineProps<{
  target?: TargetsResponse | null;
  totals?: DayTotals | null;
  label?: string;
  entries?: (NutrientSource & { id: string; kcal: number })[];
  /** The day shown. Loads the week average behind the rings' inner circle. */
  date?: string;
}>();
const large = ref(false);
function readSize() { large.value = document.documentElement.classList.contains("dt-xl"); }
onMounted(() => {
  readSize();
  window.addEventListener("resize", readSize);
});
onBeforeUnmount(() => window.removeEventListener("resize", readSize));
const sources = computed(() => props.entries ?? []);
const nutrientValues = computed(() => dayNutrients(sources.value));
const panels = computed(() => panelsForSize(large.value, cardPages.macros));
/** Page ids in swipe order. At the largest text a panel can span pages ("vitamins-0", "vitamins-1"). */
const pageIds = computed(() => ["macros", ...panels.value.map((panel) => panel.id)]);
const swipe = ref<InstanceType<typeof SwipePanels> | null>(null);
const shownPage = ref("macros");
// Hiding or showing a panel keeps the card on the same page, or sends it to Macros if that one went.
watch(pageIds, async (next) => {
  const target = followPage(shownPage.value, next);
  await nextTick();
  swipe.value?.go(target, "auto");
});
const kcalTarget = computed(() => target.value?.kcal ?? null);
const person = computed(() => nutrientPerson(kcalTarget.value));
const fatLimits = computed(() => fatLimitsOf(profile.saved?.fatLimits));
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
    <SwipePanels
      ref="swipe"
      tight
      :count="pageIds.length"
      :lock-index="-1"
      :label="label || 'Today\'s macros'"
      settings="Choose macros card pages"
      @change="shownPage = pageIds[$event] ?? 'macros'"
      @settings="openCardPages('macros')"
    >
      <MacroRows title="Macros" :goal="target" :eaten="totals" />
      <NutrientPanelSet :panels="panels" :values="nutrientValues" :entries="sources" :carbs="totals.c" :person="person" :fat-limits="fatLimits" :large="large" :week="week" />
    </SwipePanels>
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
