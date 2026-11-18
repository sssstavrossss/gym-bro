<script setup lang="ts">
import { computed } from "vue";
import Bar from "./Bar.vue";
import OverTag from "./OverTag.vue";
import { carbBreakdown, carbLimits, coverageNote, goalStatus, limitStatus, panelCoverage, type CarbPartKey, type NutrientPerson } from "../lib/nutrientCards";
import { formatNutrient, nutrientNumber, type NutrientMap, type NutrientSource } from "../lib/nutrients";

const props = defineProps<{
  /** Carbs in grams: the day's, or the portion's on the food sheet. */
  total: number;
  values: NutrientMap;
  entries: readonly NutrientSource[];
  /** Sex sets the fibre minimum, the kcal target the added sugars limit. */
  person: NutrientPerson;
  /** One food's portion, not the day: no "to go", which is about the whole day. */
  portion?: boolean;
}>();

/** The Fats card's shades: darkest for the kind that matters most, the track for the rest. */
const SWATCH: Record<CarbPartKey, string> = {
  sugars: "var(--text-primary)",
  starch: "var(--text-secondary)",
  rest: "var(--color-track)",
};
const KEYS = ["sugars", "addedSugars", "starch", "fiber", "sodium"];

const grams = (value: number) => formatNutrient(value, "g");
const breakdown = computed(() => carbBreakdown(props.total, props.values));
const parts = computed(() => breakdown.value.parts.map((part) => ({ ...part, color: SWATCH[part.key], text: grams(part.grams) })));
const stackLabel = computed(() => `Carbs ${grams(breakdown.value.total)}: ${parts.value.map((part) => `${part.label.toLowerCase()} ${part.text}`).join(", ")}, of which added sugars ${grams(breakdown.value.addedSugars)}`);
// Two columns, row by row: Added sits under Sugars, which it is part of.
const legend = computed(() => {
  const [sugars, starch, rest] = parts.value;
  return [sugars, starch, { key: "added", label: "Added", grams: breakdown.value.addedSugars, color: "", text: grams(breakdown.value.addedSugars) }, rest];
});
const note = computed(() => coverageNote(panelCoverage(props.entries, KEYS)));
const limits = computed(() => carbLimits(props.person));
const strictSodium = computed(() => props.person.sodiumLimit === "lower");

interface LimitRow {
  key: string;
  label: string;
  rule: string;
  value: string;
  cap: string;
  fraction: number;
  /** "+12 over" past a limit. */
  over: string;
  /** "21 to go" short of the fibre goal. */
  toGo: string;
  hit: boolean;
}

const rows = computed(() => {
  const out: LimitRow[] = [];
  const fibreGoal = limits.value.fibreGrams;
  if (fibreGoal != null) {
    const value = props.values.fiber ?? 0;
    const status = goalStatus(value, fibreGoal);
    out.push({
      key: "fiber", label: "Fibre", rule: "· min", value: nutrientNumber(value), cap: grams(fibreGoal), fraction: status.fraction,
      over: "", toGo: status.toGo == null || props.portion ? "" : `${nutrientNumber(status.toGo)} to go`, hit: status.toGo == null,
    });
  }
  const sugarLimit = limits.value.addedSugarsGrams;
  if (sugarLimit != null) out.push(limitRow("addedSugars", "Added sugars", "≤ 10% of kcal", props.values.addedSugars ?? 0, sugarLimit, "g"));
  out.push(limitRow("sodium", "Sodium", "", props.values.sodium ?? 0, limits.value.sodiumMg, "mg"));
  return out;
});

function limitRow(key: string, label: string, rule: string, value: number, limit: number, unit: string): LimitRow {
  const status = limitStatus(value, limit);
  return {
    key, label, rule, value: nutrientNumber(value), cap: formatNutrient(limit, unit), fraction: status.fraction,
    over: status.over == null ? "" : `+${nutrientNumber(status.over)} over`, toGo: "", hit: false,
  };
}

function barLabel(row: LimitRow): string {
  const state = row.over ? `, ${row.over}` : row.toGo ? `, ${row.toGo}` : row.hit ? ", reached" : "";
  return `${row.label} ${row.value} of ${row.cap}${state}`;
}
</script>

<template>
  <div class="panel carbs" data-panel="carbs">
    <div class="head">
      <span class="section-title panel-title">Carbs</span>
      <span class="t-label num" data-carb-total>{{ grams(breakdown.total) }}</span>
      <span v-if="strictSodium" class="tag t-capn" data-sodium-limit="lower">Strict sodium</span>
      <span v-if="note" class="t-capn c3 note">{{ note }}</span>
    </div>
    <div class="cstack" role="img" :aria-label="stackLabel">
      <i v-for="part in parts" v-show="part.grams > 0" :key="part.key" :style="{ flexGrow: part.grams, background: part.color }" />
    </div>
    <div class="two" aria-hidden="true">
      <div v-for="part in legend" :key="part.key" class="line" :data-carb-part="part.key">
        <span v-if="part.color" class="sw" :style="{ background: part.color }" />
        <span class="t-label" :class="{ 'c2 indent': !part.color }">{{ part.label }}</span>
        <span class="t-label num end">{{ part.text }}</span>
      </div>
    </div>
    <div class="limits">
      <div v-for="row in rows" :key="row.key" class="limit" :data-carb-limit="row.key">
        <div class="line">
          <span class="t-label">{{ row.label }}</span>
          <span v-if="row.rule" class="t-capn c3 rule">{{ row.rule }}</span>
          <OverTag v-if="row.over" :text="row.over" />
          <span v-else-if="row.toGo" class="tag t-capn togo" data-to-go>{{ row.toGo }}</span>
          <span class="t-label end"><span class="num">{{ row.value }}</span><span class="c3"> / {{ row.cap }}</span></span>
        </div>
        <Bar :pct="row.fraction" :hit="row.hit" :over="Boolean(row.over)" :aria-label="barLabel(row)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: var(--space-xs); min-width: 0; height: 100%; box-sizing: border-box; }
.head { display: flex; align-items: baseline; gap: var(--space-s); min-width: 0; white-space: nowrap; }
/* On a narrow phone the note gives way first, then a rule or a name: numbers never clip. */
.head .tag { align-self: center; padding-block: 0; }
.note { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.line > .t-label:not(.end), .rule { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.num { font-weight: 700; font-variant-numeric: tabular-nums; }
.line { display: flex; align-items: baseline; gap: var(--space-xs); min-width: 0; white-space: nowrap; }
.end { flex: none; margin-left: auto; }
.cstack { display: flex; gap: 2px; height: 8px; margin: var(--space-2xs) 0; border-radius: 4px; overflow: hidden; background: var(--color-track); }
.cstack i { display: block; flex-basis: 0; min-width: 2px; height: 100%; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: var(--space-l); row-gap: var(--space-2xs); }
.sw { width: 8px; height: 8px; border-radius: 2px; align-self: center; flex: none; }
/* Added sugars are part of sugars: they start where Sugars' name does. */
.indent { padding-left: calc(8px + var(--space-xs)); }
.limits { display: flex; flex-direction: column; gap: var(--space-xs); margin-top: var(--space-xs); }
.limit { display: flex; flex-direction: column; gap: 3px; }
/* Tags sit in text rows here, so they may not make a row taller than its text: the card height is fixed. */
.limit :deep(.overtag), .togo { padding-block: 0; }
.togo { align-self: center; margin-left: var(--space-2xs); }
</style>
