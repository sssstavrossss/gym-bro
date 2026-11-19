<script setup lang="ts">
import { computed } from "vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import OverTag from "./OverTag.vue";
import { int } from "../lib/format";
import { macroRows, type MacroAmounts, type MacroGoal } from "../lib/macros";

const props = withDefaults(defineProps<{
  title: string;
  /** The day's targets. Without one the rows show the amounts only. */
  goal: MacroGoal | null;
  /** The day's totals, including `adding`. */
  eaten: MacroAmounts;
  /** Food sheet: the food about to be added. Its part of each bar is brighter, and its amount sits beside the total. */
  adding?: MacroAmounts | null;
  /**
   * The "left", "to go" and "over" tags. Off for a recipe portion, which is not the day:
   * its bars show what one portion is of the day's targets.
   */
  tags?: boolean;
}>(), { adding: null, tags: true });

// Without tags nothing is judged: no tick, and the bar keeps its plain colour.
const rows = computed(() => (props.goal ? macroRows(props.goal, props.eaten, props.adding) : [])
  .map((row) => (props.tags ? row : { ...row, status: "under" as const })));
const amounts = computed(() => {
  const shown = props.adding ?? props.eaten;
  return [
    { kind: "kcal", label: "Calories", value: shown.kcal, unit: "kcal" },
    { kind: "p", label: "Protein", value: shown.p, unit: "g" },
    { kind: "f", label: "Fat", value: shown.f, unit: "g" },
    { kind: "c", label: "Carbs", value: shown.c, unit: "g" },
  ];
});

function barLabel(row: (typeof rows.value)[number]): string {
  if (!props.tags) return `${row.label} ${int(row.current)} of ${int(row.target)} ${row.unit}`;
  const state = row.status === "hit" ? ", on target" : row.status === "over" ? `, over by ${int(row.current - row.target)}` : `, ${row.tag}`;
  const added = props.adding ? `, this food ${int(row.adding)}` : "";
  return `${row.label} ${int(row.current)} of ${int(row.target)} ${row.unit}${added}${state}`;
}
</script>

<template>
  <div class="macropane" data-panel="macros">
    <span class="section-title panel-title">{{ title }}</span>
    <div v-if="goal" class="mrows">
      <div v-for="row in rows" :key="row.kind" class="col mitem" :data-macro="row.kind">
        <div class="mrow">
          <span class="left">
            <span class="t-label" :class="row.status === 'under' ? 'c2' : ''">{{ row.label }}<span v-if="row.min" class="c3 t-capn"> · min</span></span>
            <template v-if="tags">
              <OverTag v-if="row.status === 'over'" :text="row.tag" />
              <span v-else-if="row.tag" class="tag t-capn lefttag" data-left>{{ row.tag }}</span>
            </template>
          </span>
          <span class="vals">
            <span v-if="adding" class="t-capn c2" data-adding>+{{ int(row.adding) }}</span>
            <span class="t-bodys" data-num>{{ int(row.current) }}</span>
            <span class="t-label c3">/ {{ int(row.target) }} {{ row.unit }}</span>
            <span class="tick" aria-hidden="true"><Icon v-if="row.status === 'hit'" name="check" :size="14" :sw="3" /></span>
          </span>
          <span v-if="row.status === 'hit'" class="sr-only">on target</span>
        </div>
        <Bar :pct="row.fraction" :added="row.added" :hit="row.status === 'hit'" :over="row.status === 'over'" :aria-label="barLabel(row)" />
      </div>
    </div>
    <div v-else class="mrows plain">
      <div v-for="row in amounts" :key="row.kind" class="mrow" :data-macro="row.kind">
        <span class="t-label">{{ row.label }}</span>
        <span class="vals"><span class="t-bodys" data-num>{{ int(row.value) }}</span><span class="t-label c3">{{ row.unit }}</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.macropane { display: flex; flex-direction: column; gap: var(--space-xs); min-height: 0; height: 100%; box-sizing: border-box; }
/* The four rows spread over the card's height, so the card has no empty band at the bottom. */
.mrows { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 0; padding-top: var(--space-xs); }
.mrows.plain { justify-content: flex-start; gap: var(--space-s); }
.mitem { gap: var(--space-2xs); }
.mrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-s); min-width: 0; }
.left { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-xs); min-width: 0; }
/* Sits like the dashed over tag: the two read as a pair. */
.lefttag { align-self: center; margin-left: var(--space-2xs); white-space: nowrap; }
.vals {
  display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; gap: var(--space-xs);
  max-width: 100%;
}
.vals > * { flex: none; white-space: nowrap; }
.tick { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; align-self: center; }
</style>
