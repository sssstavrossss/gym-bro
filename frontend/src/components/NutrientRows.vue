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
const halves = computed(() => props.panel.halves === true);
</script>

<template>
  <div class="panel" :data-panel="panel.id">
    <span class="section-title panel-title">{{ panel.title }}</span>
    <div v-if="per100 && !halves" class="heads t-capn c2" :class="{ pcts: showPercent }"><span></span><span>Per 100 g</span><span v-if="showPercent"></span><span>Amount</span></div>
    <div class="list" :class="{ grid: halves || (panel.grid && !per100), paired: Boolean(per100) && !halves, pcts: showPercent }" :style="halves || (panel.grid && !per100) ? { '--half': String(Math.ceil(rows.length / 2)) } : undefined">
      <div v-for="row in rows" :key="row.key" class="nrow" :class="{ miss: row.missing }">
        <span class="t-label name" :class="{ indent: row.indent }">{{ row.label }}</span>
        <template v-if="per100 && !halves">
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
.list { display: flex; flex-direction: column; flex: none; min-height: 0; justify-content: flex-start; align-content: flex-start; }
.list.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: repeat(var(--half), auto);
  grid-auto-flow: column;
  column-gap: var(--space-gap);
  row-gap: 2px;
}
.list.grid .nrow { column-gap: calc(var(--space-gap) / 3); }
.list.grid .fig { grid-template-columns: 3ch 1.35em; column-gap: 0.2em; }
.list.grid .pct { width: 4ch; overflow: hidden; white-space: nowrap; text-align: right; }
.list.grid .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
html.dt-xl .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
