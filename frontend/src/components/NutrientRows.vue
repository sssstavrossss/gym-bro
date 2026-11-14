<script setup lang="ts">
import { computed } from "vue";
import { formatNutrient, nutrientParts, nutrientPercent, nutrientRow, type NutrientMap, type NutrientPanelDef } from "../lib/nutrients";

const props = defineProps<{
  panel: NutrientPanelDef;
  values: NutrientMap;
  per100?: NutrientMap | null;
  sex: string;
  age: number;
  kcalTarget: number | null;
}>();

const rows = computed(() => props.panel.keys.map((key) => {
  const meta = nutrientRow(key);
  const value = props.values[key] ?? null;
  const perValue = props.per100 ? props.per100[key] ?? null : null;
  return {
    key,
    label: meta.label,
    amount: nutrientParts(value, meta.unit),
    amountText: formatNutrient(value, meta.unit),
    per: props.per100 ? nutrientParts(perValue, meta.unit) : null,
    perText: props.per100 ? formatNutrient(perValue, meta.unit) : null,
    percent: nutrientPercent(key, value, props.sex, props.age, props.kcalTarget),
    missing: value == null,
    indent: props.panel.indent?.includes(key) ?? false,
  };
}));
const showPercent = computed(() => rows.value.some((row) => row.percent != null));
</script>

<template>
  <div class="panel" :data-panel="panel.id">
    <span class="t-label title">{{ panel.title }}</span>
    <div v-if="per100" class="heads t-capn c2" :class="{ pcts: showPercent }"><span></span><span>Per 100 g</span><span v-if="showPercent"></span><span>Amount</span></div>
    <div class="list" :class="{ grid: panel.grid && !per100, paired: per100, pcts: showPercent }">
      <div v-for="row in rows" :key="row.key" class="nrow" :class="{ miss: row.missing }">
        <span class="t-label name" :class="{ indent: row.indent }">{{ row.label }}</span>
        <template v-if="per100">
          <span class="fig per t-bodys" data-num>
            <span class="num">{{ row.per?.whole }}{{ row.per?.frac }}</span><span class="unit">{{ row.per?.unit }}</span>
          </span>
          <span v-if="showPercent" class="t-label pct">{{ row.percent != null ? `${row.percent}%` : "" }}</span>
          <span class="fig amt t-bodys" data-num>
            <span class="num">{{ row.amount.whole }}{{ row.amount.frac }}</span><span class="unit">{{ row.amount.unit }}</span>
          </span>
        </template>
        <span v-else class="nums">
          <span class="fig t-bodys" data-num>
            <span class="num">{{ row.amount.whole }}{{ row.amount.frac }}</span><span class="unit">{{ row.amount.unit }}</span>
          </span>
          <span v-if="showPercent" class="t-label pct">{{ row.percent != null ? `${row.percent}%` : "" }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 4px; min-width: 0; height: 100%; box-sizing: border-box; }
.title { color: var(--text-secondary); }
.list { display: flex; flex-direction: column; flex: none; min-height: 0; justify-content: flex-start; align-content: flex-start; }
.list.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, auto);
  grid-auto-flow: column;
  column-gap: 16px;
}
.nrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex: none;
}
.heads, .list.paired .nrow { display: grid; grid-template-columns: minmax(0, 1fr) 5.6rem 5.6rem; column-gap: 12px; align-items: baseline; width: 100%; }
.heads.pcts, .list.paired.pcts .nrow { grid-template-columns: minmax(0, 1fr) 5.6rem 2.2rem 5.6rem; }
.heads span:not(:first-child) { justify-self: stretch; text-align: right; }
.per, .amt { justify-self: end; }
.pct { justify-self: end; text-align: right; }
.fig {
  display: inline-grid;
  grid-template-columns: 4ch 1.65em;
  column-gap: 0.25em;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}
.fig > .num { text-align: right; }
.unit { text-align: left; }
.nums { display: inline-flex; justify-content: flex-end; align-items: baseline; gap: 8px; white-space: nowrap; }
.pct { width: 3.6ch; font-variant-numeric: tabular-nums; }
.name { min-width: 0; overflow-wrap: anywhere; }
.name.indent { padding-left: 12px; }
.num { white-space: nowrap; }
.miss .fig { color: var(--text-tertiary); }
.pct { color: var(--text-secondary); }
html.dt-xl .nums { flex-direction: column; align-items: flex-end; gap: 0; }
</style>
