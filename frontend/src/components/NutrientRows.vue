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
    indent: props.panel.indent?.includes(key) ?? false,
  };
}));
</script>

<template>
  <div class="panel" :data-panel="panel.id">
    <span class="t-label title">{{ panel.title }}</span>
    <div v-if="per100" class="heads t-capn c2"><span></span><span>Per 100 g</span><span>Amount</span></div>
    <div class="list" :class="{ grid: panel.grid && !per100, paired: per100 }">
      <div v-for="row in rows" :key="row.key" class="nrow" :class="{ miss: row.missing }">
        <span class="t-label name" :class="{ indent: row.indent }">{{ row.label }}</span>
        <template v-if="per100">
          <span class="t-bodys num per" data-num>{{ row.per }}</span>
          <span class="amt">
            <span v-if="row.percent != null" class="t-label pct">{{ row.percent }}%</span>
            <span class="t-bodys num" data-num>{{ row.text }}</span>
          </span>
        </template>
        <span v-else class="nums">
          <span class="t-bodys num" data-num>{{ row.text }}</span>
          <span v-if="row.percent != null" class="t-label pct">{{ row.percent }}%</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 2px; min-width: 0; height: 100%; box-sizing: border-box; padding-bottom: 2px; }
.title { color: var(--text-secondary); line-height: 0.9412rem; }
.list { display: flex; flex-direction: column; min-width: 0; }
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
  line-height: 0.9412rem;
}
.name, .num, .pct { line-height: 0.9412rem; }
.heads, .list.paired .nrow { display: grid; grid-template-columns: minmax(0, 1fr) max-content max-content; column-gap: 16px; align-items: baseline; width: 100%; }
.heads span:not(:first-child), .per, .amt { justify-self: end; text-align: right; }
.amt { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 8px; }
.nums { display: flex; justify-content: flex-end; align-items: baseline; gap: 8px; white-space: nowrap; }
.name { min-width: 0; overflow-wrap: anywhere; }
.name.indent { padding-left: 12px; }
.num { white-space: nowrap; }
.miss .num { color: var(--text-tertiary); }
.pct { color: var(--text-secondary); }
html.dt-xl .nums { flex-direction: column; align-items: flex-end; gap: 0; }
</style>
