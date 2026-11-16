<script setup lang="ts">
import CarbsPanel from "./CarbsPanel.vue";
import FatsPanel from "./FatsPanel.vue";
import NutrientRows from "./NutrientRows.vue";
import RingsPanel from "./RingsPanel.vue";
import type { FatLimitsSetting, NutrientPerson } from "../lib/nutrientCards";
import type { NutrientMap, NutrientPanelDef, NutrientSource } from "../lib/nutrients";

/**
 * The nutrient cards after Macros, on Home and on the food sheet. Each panel is one page of
 * the SwipePanels around it, so this renders the pages side by side with no wrapper.
 */
const props = defineProps<{
  panels: NutrientPanelDef[];
  values: NutrientMap;
  entries: readonly NutrientSource[];
  /** Carbs in grams, for the Carbs card's total. */
  carbs: number;
  person: NutrientPerson;
  fatLimits: FatLimitsSetting;
  /** Largest text: plain rows, four to a page, instead of the cards. */
  large: boolean;
  /** Daily average over the week for the rings' inner circle. */
  week?: NutrientMap;
  /** Food sheet: one food's portion, with per 100 g beside the plain rows at the largest text. */
  portion?: boolean;
  per100?: NutrientMap | null;
}>();

function viewOf(panel: NutrientPanelDef): "fats" | "carbs" | "rings" | "rows" {
  if (props.large) return "rows";
  if (panel.id === "fats" || panel.id === "carbs") return panel.id;
  return panel.id === "vitamins" || panel.id === "minerals" ? "rings" : "rows";
}
</script>

<template>
  <template v-for="panel in panels" :key="panel.id">
    <FatsPanel v-if="viewOf(panel) === 'fats'" :values="values" :entries="entries" :kcal-target="person.kcalTarget" :setting="fatLimits" />
    <CarbsPanel v-else-if="viewOf(panel) === 'carbs'" :total="carbs" :values="values" :entries="entries" :person="person" :portion="portion" />
    <RingsPanel v-else-if="viewOf(panel) === 'rings'" :panel="panel" :values="values" :week="week ?? {}" :entries="entries" :person="person" :portion="portion" />
    <NutrientRows v-else :panel="panel" :values="values" :per100="per100" :sex="person.sex" :age="person.age" :kcal-target="person.kcalTarget" />
  </template>
</template>
