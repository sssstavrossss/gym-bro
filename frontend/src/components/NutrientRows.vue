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
    amount: nutrientParts(value, meta.unit, meta.fine),
    amountText: formatNutrient(value, meta.unit, meta.fine),
    per: props.per100 ? nutrientParts(perValue, meta.unit, meta.fine) : null,
    perText: props.per100 ? formatNutrient(perValue, meta.unit, meta.fine) : null,
    percent: nutrientPercent(key, value, props.sex, props.age, props.kcalTarget),
    missing: value == null,
    indent: props.panel.indent?.includes(key) ?? false,
  };
}));
const showPercent = computed(() => rows.value.some((row) => row.percent != null));
const halves = computed(() => props.panel.halves === true);
const mid = computed(() => Math.ceil(rows.value.length / 2));
const leftRows = computed(() => rows.value.slice(0, mid.value));
const rightRows = computed(() => rows.value.slice(mid.value));
</script>

<template>
  <div class="panel" :data-panel="panel.id">
    <span class="section-title panel-title">{{ panel.title }}</span>
    <div v-if="per100 && !halves" class="heads t-capn c2" :class="{ pcts: showPercent }"><span></span><span>Per 100 g</span><span v-if="showPercent"></span><span>Amount</span></div>
    <div v-if="halves" class="list halves">
      <div v-for="(side, index) in [leftRows, rightRows]" :key="index" class="half" :class="{ pcts: showPercent }">
        <div v-for="row in side" :key="row.key" class="nrow" :class="{ miss: row.missing }">
          <span class="t-label name">{{ row.label }}</span>
          <span class="nums">
            <span class="fig t-bodys" data-num>
              <span class="num">{{ row.amount.whole }}{{ row.amount.frac }}</span>
              <span class="unit"><span>{{ row.amount.unit }}</span><span class="sizer" aria-hidden="true">mg</span></span>
            </span>
            <span v-if="showPercent" class="t-label pct">{{ row.percent != null ? `${row.percent}%` : "" }}</span>
          </span>
        </div>
      </div>
    </div>
    <div v-else class="list" :class="{ grid: panel.grid && !per100, paired: Boolean(per100), pcts: showPercent }" :style="panel.grid && !per100 ? { '--half': String(Math.ceil(rows.length / 2)) } : undefined">
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
.list.halves {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(max-content, 1fr);
  align-items: start;
  column-gap: var(--space-gap);
}
.half {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) max-content max-content;
  column-gap: 0;
  row-gap: 2px;
  align-items: baseline;
}
.half.pcts { grid-template-columns: minmax(max-content, 1fr) max-content max-content max-content; }
.list.halves .nrow,
.list.halves .nums,
.list.halves .fig { display: contents; }
.list.halves .name {
  margin-right: 2px;
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
  font-size: calc(0.7647rem - 1px);
}
.list.halves .num { text-align: right; margin-right: 0.15em; justify-self: end; }
.list.halves .unit {
  display: inline-grid;
  justify-items: start;
  margin: 0;
  white-space: nowrap;
}
.list.halves .unit > * { grid-area: 1 / 1; }
.list.halves .sizer { visibility: hidden; }
.list.halves .pct {
  display: block;
  width: auto;
  margin: 0 0 0 6px;
  text-align: right;
  white-space: nowrap;
  font-size: calc(0.7647rem - 1px);
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
.heads, .list.paired .nrow { display: grid; grid-template-columns: minmax(0, 1fr) 4.6rem 4.6rem; column-gap: 12px; align-items: baseline; width: 100%; }
.heads.pcts, .list.paired.pcts .nrow { grid-template-columns: minmax(0, 1fr) 4.6rem 2.2rem 4.6rem; }
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
html.dt-xl .list.halves .name,
html.dt-xl .list.halves .pct { font-size: 14px; }
html.dt-xl .heads,
html.dt-xl .list.paired .nrow { grid-template-columns: minmax(max-content, 1fr) 72px 72px; }
html.dt-xl .heads.pcts,
html.dt-xl .list.paired.pcts .nrow { grid-template-columns: minmax(max-content, 1fr) 64px 40px 72px; }
html.dt-xl .list.paired .name { white-space: nowrap; overflow: visible; text-overflow: clip; }
</style>
