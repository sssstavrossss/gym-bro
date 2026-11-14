<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import ManualTag from "./ManualTag.vue";
import NutrientRows from "./NutrientRows.vue";
import SwipePanels from "./SwipePanels.vue";
import { int } from "../lib/format";
import { macroStatus, type MacroKind } from "../lib/macros";
import { dayNutrients, osloYear, panelsForSize, type NutrientSource } from "../lib/nutrients";
import { dayTotals, type DayTotals } from "../state/log";
import { profile } from "../state/profile";
import type { TargetsResponse } from "../api";

const props = defineProps<{ target?: TargetsResponse | null; totals?: DayTotals | null; label?: string; manual?: boolean; entries?: NutrientSource[] }>();
const large = ref(false);
function readSize() { large.value = document.documentElement.classList.contains("dt-xl"); }
onMounted(() => {
  readSize();
  window.addEventListener("resize", readSize);
});
onBeforeUnmount(() => window.removeEventListener("resize", readSize));
const sources = computed(() => props.entries ?? []);
const nutrientValues = computed(() => dayNutrients(sources.value));
const panels = computed(() => panelsForSize(sources.value, large.value));
const age = computed(() => {
  const year = profile.saved?.birthYear;
  return typeof year === "number" ? osloYear() - year : 0;
});
const kcalTarget = computed(() => target.value?.kcal ?? null);
const target = computed(() => (props.target === undefined ? profile.targets : props.target));
const totals = computed(() => props.totals ?? dayTotals());
const macros = computed(() => {
  const goal = target.value;
  const eaten = totals.value;
  if (!goal) return [];
  const rows: { kind: MacroKind; label: string; cur: number; tgt: number; unit: string; min: boolean }[] = [
    { kind: "kcal", label: "Calories", cur: eaten.kcal, tgt: goal.kcal, unit: "kcal", min: false },
    { kind: "p", label: "Protein", cur: eaten.p, tgt: goal.protein, unit: "g", min: true },
    { kind: "f", label: "Fat", cur: eaten.f, tgt: goal.fat, unit: "g", min: false },
    { kind: "c", label: "Carbs", cur: eaten.c, tgt: goal.carbs, unit: "g", min: false },
  ];
  return rows.map((row) => ({ ...row, st: macroStatus(row.kind, row.cur, row.tgt) }));
});
</script>

<template>
  <section v-if="!target" class="card macros">
    <span class="t-label">No target on this day</span>
    <p class="t-capn c2 m0">This day is before your first target, so it isn't judged or counted in on-target stats.</p>
    <div class="row nt">
      <span class="t-bodys" data-num>{{ int(totals.kcal) }}</span><span class="t-capn c2">kcal</span>
      <span class="t-bodys" data-num>{{ int(totals.p) }}</span><span class="t-capn c2">P</span>
      <span class="t-bodys" data-num>{{ int(totals.f) }}</span><span class="t-capn c2">F</span>
      <span class="t-bodys" data-num>{{ int(totals.c) }}</span><span class="t-capn c2">C</span>
    </div>
  </section>
  <section v-else class="card macros" :aria-label="label || 'Today\'s macros'">
    <SwipePanels :count="panels.length + 1" :lock-index="0" :label="label || 'Today\'s macros'">
    <div class="macropane" data-panel="macros">
    <div v-for="m in macros" :key="m.label" class="col gap6">
      <div class="row mrow">
        <span class="t-label" :class="m.st === 'under' ? 'c2' : ''">{{ m.label }}<span v-if="m.min" class="c3 t-capn"> · min</span></span>
        <ManualTag v-if="manual && m.kind === 'kcal'" />
        <span v-if="m.st === 'over'" class="overtag t-capn">+{{ int(m.cur - m.tgt) }} over</span>
        <span class="grow" />
        <span class="vals">
          <span class="t-bodys" data-num>{{ int(m.cur) }}</span>
          <span class="t-label c3">/ {{ int(m.tgt) }} {{ m.unit }}</span>
          <span class="tick" aria-hidden="true"><Icon v-if="m.st === 'hit'" name="check" :size="14" :sw="3" /></span>
        </span>
        <span v-if="m.st === 'hit'" class="sr-only">on target</span>
      </div>
      <Bar :pct="m.tgt ? m.cur / m.tgt : 0" :hit="m.st === 'hit'" :over="m.st === 'over'" :aria-label="`${m.label} ${int(m.cur)} of ${int(m.tgt)} ${m.unit}${m.st === 'hit' ? ', on target' : m.st === 'over' ? ', over' : ''}`" />
    </div>
    </div>
    <NutrientRows v-for="panel in panels" :key="panel.id" :panel="panel" :values="nutrientValues" :sex="profile.saved?.sex ?? ''" :age="age" :kcal-target="kcalTarget" />
    </SwipePanels>
  </section>
</template>

<style scoped>
.macros { gap: 14px; }
.gap6 { gap: 6px; }
.mrow { gap: 4px; align-items: baseline; flex-wrap: wrap; min-width: 0; max-width: 100%; }
.vals {
  display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; gap: 4px;
  margin-left: auto; max-width: 100%;
}
.vals > * { flex: none; white-space: nowrap; }
.tick { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; align-self: center; }
.m0 { margin: 0; }
.nt { gap: 4px; align-items: baseline; flex-wrap: wrap; }
.nt .t-capn { margin-right: 10px; }
.overtag { align-self: center; padding: 1px 6px; border-radius: 6px; border: 1px dashed var(--text-secondary); color: var(--text-secondary); margin-left: 2px; }
</style>
