<script setup lang="ts">
import { computed } from "vue";
import { formatNutrient, nutrientPercent, nutrientRow, type NutrientMap, type NutrientPanelDef } from "../lib/nutrients";

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
  const percent = nutrientPercent(key, value, props.sex, props.age, props.kcalTarget);
  return {
    key,
    label: meta.label,
    text: formatNutrient(value, meta.unit),
    per: props.per100 ? formatNutrient(props.per100[key] ?? null, meta.unit) : null,
    percent,
    missing: value == null,
  };
}));
</script>

<template>
  <div class="panel" :data-panel="panel.id">
    <span class="t-label title">{{ panel.title }}</span>
    <div v-if="per100" class="heads t-capn c2"><span></span><span>Per 100 g</span><span>Amount</span><span></span></div>
    <div class="list" :class="{ grid: panel.grid && !per100, paired: per100 }">
      <div v-for="row in rows" :key="row.key" class="nrow" :class="{ miss: row.missing }">
        <span class="t-label name">{{ row.label }}</span>
        <span v-if="row.per" class="t-bodys num per" data-num>{{ row.per }}</span>
        <span class="t-bodys num" data-num>{{ row.text }}</span>
        <span v-if="row.percent != null" class="t-label pct">{{ row.percent }}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.title { color: var(--text-secondary); }
.list { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.list.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.nrow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-height: 28px; min-width: 0; }
.list.grid .nrow { flex-direction: column; gap: 2px; align-items: flex-start; }
.heads, .list.paired .nrow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto 44px; column-gap: 12px; align-items: baseline; }
.heads span, .list.paired .num, .list.paired .pct { text-align: right; }
.name { min-width: 0; }
.num { white-space: nowrap; }
.miss .num { color: var(--text-tertiary); }
.pct { text-align: right; color: var(--text-secondary); }
html.dt-xl .list.grid { grid-template-columns: 1fr; }
html.dt-xl .heads, html.dt-xl .list.paired .nrow { grid-template-columns: minmax(0, 1fr); row-gap: 2px; }
html.dt-xl .heads span:empty { display: none; }
</style>
