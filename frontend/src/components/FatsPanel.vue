<script setup lang="ts">
import { computed } from "vue";
import Bar from "./Bar.vue";
import OverTag from "./OverTag.vue";
import { coverageNote, fatBreakdown, fatLimits, limitStatus, panelCoverage, type FatLimitsSetting, type FatPartKey } from "../lib/nutrientCards";
import { formatNutrient, nutrientNumber, nutrientRow, type NutrientMap, type NutrientSource } from "../lib/nutrients";

const props = defineProps<{
  values: NutrientMap;
  entries: readonly NutrientSource[];
  kcalTarget: number | null;
  setting: FatLimitsSetting;
}>();

/** Darkest for the kind that matters most. Not broken down is the empty track. */
const SWATCH: Record<FatPartKey, string> = {
  saturatedFat: "var(--text-primary)",
  monoFat: "var(--text-secondary)",
  polyFat: "var(--text-tertiary)",
  transFat: "var(--shade-off)",
  rest: "var(--color-track)",
};
const KINDS = ["saturatedFat", "monoFat", "polyFat", "transFat", "omega3", "epaDha", "omega6", "cholesterol"];

const grams = (value: number) => formatNutrient(value, "g");
const breakdown = computed(() => fatBreakdown(props.values));
const parts = computed(() => breakdown.value.parts.map((part) => ({ ...part, color: SWATCH[part.key], text: grams(part.grams) })));
const stackLabel = computed(() => `Fat ${grams(breakdown.value.total)}: ${parts.value.map((part) => `${part.label.toLowerCase()} ${part.text}`).join(", ")}`);
const note = computed(() => coverageNote(panelCoverage(props.entries, KINDS)));
const limits = computed(() => fatLimits(props.setting, props.kcalTarget));
const lower = computed(() => limits.value.setting === "lower");

const saturated = computed(() => {
  const limit = limits.value.saturatedGrams;
  if (limit == null) return null;
  const value = props.values.saturatedFat ?? 0;
  const status = limitStatus(value, limit);
  const over = status.over == null ? "" : `+${nutrientNumber(status.over)} over`;
  return { value: nutrientNumber(value), limit: grams(limit), fraction: status.fraction, over };
});

// Two columns, row by row: EPA + DHA sits under Omega-3, which it is part of.
const extras = computed(() => ["omega3", "omega6", "epaDha", "cholesterol"].map((key) => {
  const row = nutrientRow(key);
  const value = props.values[key] ?? 0;
  const cap = key === "cholesterol" ? limits.value.cholesterolMg : null;
  return {
    key,
    label: row.label,
    indent: key === "epaDha",
    value: cap == null ? formatNutrient(value, row.unit) : nutrientNumber(value),
    cap: cap == null ? "" : `/ ${formatNutrient(cap, row.unit)}`,
    over: cap != null && value > cap,
  };
}));
</script>

<template>
  <div class="panel fats" data-panel="fats">
    <div class="head">
      <span class="section-title panel-title">Fats</span>
      <span class="t-label num" data-fat-total>{{ grams(breakdown.total) }}</span>
      <span v-if="lower" class="tag t-capn" data-fat-limits="lower">Lower limits</span>
      <span v-if="note" class="t-capn c3 note">{{ note }}</span>
    </div>
    <div class="fstack" role="img" :aria-label="stackLabel">
      <i v-for="part in parts" v-show="part.grams > 0" :key="part.key" :style="{ flexGrow: part.grams, background: part.color }" />
    </div>
    <div class="two" aria-hidden="true">
      <div v-for="part in parts" :key="part.key" class="line" :data-fat-part="part.key">
        <span class="sw" :style="{ background: part.color }" />
        <span class="t-label">{{ part.label }}</span>
        <span class="t-label num end">{{ part.text }}</span>
      </div>
    </div>
    <div v-if="saturated" class="limit" data-saturated-limit>
      <div class="line">
        <span class="t-label">Saturated</span>
        <span class="t-capn c3">≤ {{ limits.saturatedPercent }}% of kcal</span>
        <OverTag v-if="saturated.over" :text="saturated.over" />
        <span class="t-label end"><span class="num">{{ saturated.value }}</span><span class="c3"> / {{ saturated.limit }}</span></span>
      </div>
      <Bar :pct="saturated.fraction" :over="Boolean(saturated.over)" :aria-label="`Saturated fat ${saturated.value} of ${saturated.limit} limit${saturated.over ? `, ${saturated.over}` : ''}`" />
    </div>
    <div class="two extras">
      <div v-for="row in extras" :key="row.key" class="line" :data-fat-row="row.key">
        <span class="t-label c2" :class="{ indent: row.indent }">{{ row.label }}</span>
        <span class="t-label end">
          <span class="num" :class="{ overval: row.over }">{{ row.value }}</span><span v-if="row.cap" class="t-capn c3 cap">{{ row.cap }}</span>
        </span>
        <span v-if="row.over" class="sr-only">over the limit</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: var(--space-xs); min-width: 0; height: 100%; box-sizing: border-box; }
.head { display: flex; align-items: baseline; gap: var(--space-s); min-width: 0; white-space: nowrap; }
.head .tag { align-self: center; padding-block: 0; }
/* On a narrow phone the note gives way first, then a row's name: numbers never clip. */
.note { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.line > .t-label:not(.end) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.end { flex: none; }
.num { font-weight: 700; font-variant-numeric: tabular-nums; }
.line { display: flex; align-items: baseline; gap: var(--space-xs); min-width: 0; white-space: nowrap; }
.end { margin-left: auto; }
.fstack { display: flex; gap: 2px; height: 8px; margin: var(--space-2xs) 0; border-radius: 4px; overflow: hidden; background: var(--color-track); }
.fstack i { display: block; flex-basis: 0; min-width: 2px; height: 100%; }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: var(--space-l); row-gap: var(--space-2xs); }
.sw { width: 8px; height: 8px; border-radius: 2px; align-self: center; flex: none; }
/* Tags sit in text rows here, so they may not make a row taller than its text: the card height is fixed. */
.limit :deep(.overtag) { padding-block: 0; }
.limit { display: flex; flex-direction: column; gap: 3px; margin-top: var(--space-xs); }
.extras { margin-top: var(--space-xs); }
.cap { margin-left: 0.3em; }
.indent { padding-left: var(--space-m); }
/* Over the cap: dashed like the over tag, without taking width from a tight row. */
.overval { text-decoration: underline dashed var(--text-secondary); text-decoration-thickness: 1px; text-underline-offset: 3px; }
</style>
