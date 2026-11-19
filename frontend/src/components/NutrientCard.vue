<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MacroRows from "./MacroRows.vue";
import NutrientPanelSet from "./NutrientPanelSet.vue";
import SwipePanels from "./SwipePanels.vue";
import { followPage } from "../lib/cardPages";
import type { MacroAmounts, MacroGoal } from "../lib/macros";
import { fatLimitsOf } from "../lib/nutrientCards";
import { panelsForSize, type NutrientMap, type NutrientSource } from "../lib/nutrients";
import { cardPages } from "../state/cardPages";
import { nutrientPerson, profile } from "../state/profile";
import { openCardPages } from "../ui";

/**
 * The macros swipe card: a Macros page, then the nutrient panels. Home, the amount screens and
 * the recipe editor all show it. The pages it shows are one choice, made from the cog on any of them.
 */
const props = withDefaults(defineProps<{
  /** The Macros page's title: "Macros", "Today after adding", "Per portion". */
  title: string;
  /** Targets for the Macros bars. Without one the page lists the amounts. */
  goal: MacroGoal | null;
  /** What the bars show, including `adding`. */
  eaten: MacroAmounts;
  /** About to be added: its part of each bar is brighter. */
  adding?: MacroAmounts | null;
  /** "Left", "to go" and "over" on the Macros page. */
  tags?: boolean;
  /** The panels' values, and the foods behind them (for the coverage notes). */
  values: NutrientMap;
  entries: readonly NutrientSource[];
  /** Carbs in grams, for the Carbs card's total. */
  carbs: number;
  /** One amount, not a day: the rings don't open the day's nutrient sheet. */
  portion?: boolean;
  /** Per 100 g beside the plain rows at the largest text. */
  per100?: NutrientMap | null;
  /** The week's daily average behind the rings. */
  week?: NutrientMap;
  label: string;
}>(), { adding: null, tags: true, portion: false, per100: null, week: undefined });

const large = ref(false);
function readSize() { large.value = document.documentElement.classList.contains("dt-xl"); }
onMounted(() => {
  readSize();
  window.addEventListener("resize", readSize);
});
onBeforeUnmount(() => window.removeEventListener("resize", readSize));

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
const person = computed(() => nutrientPerson(props.goal?.kcal ?? null));
const fatLimits = computed(() => fatLimitsOf(profile.saved?.fatLimits));
</script>

<template>
  <SwipePanels
    ref="swipe"
    tight
    :count="pageIds.length"
    :lock-index="-1"
    :label="label"
    settings="Choose macros card pages"
    @change="shownPage = pageIds[$event] ?? 'macros'"
    @settings="openCardPages('macros')"
  >
    <MacroRows :title="title" :goal="goal" :eaten="eaten" :adding="adding" :tags="tags" />
    <NutrientPanelSet :panels="panels" :values="values" :entries="entries" :carbs="carbs" :person="person" :fat-limits="fatLimits" :large="large" :week="week" :portion="portion" :per100="per100" />
  </SwipePanels>
</template>
