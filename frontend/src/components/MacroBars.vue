<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Bar from "./Bar.vue";
import FatsPanel from "./FatsPanel.vue";
import Icon from "./Icon.vue";
import ManualTag from "./ManualTag.vue";
import OverTag from "./OverTag.vue";
import NutrientRows from "./NutrientRows.vue";
import RingsPanel from "./RingsPanel.vue";
import SwipePanels from "./SwipePanels.vue";
import { int } from "../lib/format";
import { macroStatus, type MacroKind } from "../lib/macros";
import { fatLimitsOf } from "../lib/nutrientCards";
import { dayNutrients, panelsForSize, type NutrientPanelDef, type NutrientSource } from "../lib/nutrients";
import { dayTotals, type DayTotals } from "../state/log";
import { loadNutrientWeek, nutrientWeek } from "../state/nutrientWeek";
import { nutrientPerson, profile } from "../state/profile";
import type { TargetsResponse } from "../api";

const props = defineProps<{
  target?: TargetsResponse | null;
  totals?: DayTotals | null;
  label?: string;
  manual?: boolean;
  entries?: (NutrientSource & { id: string; kcal: number })[];
  /** The day shown. Loads the week average behind the rings' inner circle. */
  date?: string;
}>();
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
const kcalTarget = computed(() => target.value?.kcal ?? null);
const person = computed(() => nutrientPerson(kcalTarget.value));
const fatLimits = computed(() => fatLimitsOf(profile.saved?.fatLimits));
/** Default text has the Fats card and the ring grids. Largest text keeps plain rows, four to a page. */
function viewOf(panel: NutrientPanelDef): "fats" | "rings" | "rows" {
  if (large.value) return "rows";
  if (panel.id === "fats") return "fats";
  return panel.id === "vitamins" || panel.id === "minerals" ? "rings" : "rows";
}
const week = computed(() => (nutrientWeek.date === props.date ? nutrientWeek.average : {}));
// An added, removed, or edited entry changes the week, so reload on each.
const entrySignature = computed(() => sources.value.map((entry) => `${entry.id}:${entry.kcal}:${entry.fat}`).join("|"));
watch([() => props.date, entrySignature], ([date]) => {
  if (date) void loadNutrientWeek(date);
}, { immediate: true });
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
  <section v-else class="card macros fit" data-nutrient-card :aria-label="label || 'Today\'s macros'">
    <SwipePanels tight :count="panels.length + 1" :lock-index="-1" :label="label || 'Today\'s macros'">
    <div class="macropane" data-panel="macros">
    <span class="section-title panel-title">Macros</span>
    <div v-for="m in macros" :key="m.label" class="col gap6">
      <div class="mrow">
        <span class="left">
          <span class="t-label" :class="m.st === 'under' ? 'c2' : ''">{{ m.label }}<span v-if="m.min" class="c3 t-capn"> · min</span></span>
          <ManualTag v-if="manual && m.kind === 'kcal'" />
          <OverTag v-if="m.st === 'over'" :text="`+${int(m.cur - m.tgt)} over`" />
        </span>
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
    <template v-for="panel in panels" :key="panel.id">
      <FatsPanel v-if="viewOf(panel) === 'fats'" :values="nutrientValues" :entries="sources" :kcal-target="kcalTarget" :setting="fatLimits" />
      <RingsPanel v-else-if="viewOf(panel) === 'rings'" :panel="panel" :values="nutrientValues" :week="week" :entries="sources" :person="person" />
      <NutrientRows v-else :panel="panel" :values="nutrientValues" :sex="person.sex" :age="person.age" :kcal-target="kcalTarget" />
    </template>
    </SwipePanels>
  </section>
</template>

<style scoped>
.macros { gap: var(--space-l); }
/* The dot strip ends at the card's bottom edge (its own 6px below the dots). The clip lets the
   dots' 44px hit box reach past that edge, where nothing else is tappable. */
.macros.fit { height: 222px; box-sizing: border-box; gap: 0; padding-bottom: 0; clip-path: inset(0 0 -14px 0); }
.macropane { display: flex; flex-direction: column; gap: var(--space-xs); min-height: 0; }
.gap6 { gap: var(--space-2xs); }
html.dt-xl .mrow { grid-template-columns: minmax(0, 1fr) auto; }
html.dt-xl .vals { justify-content: flex-end; }
.mrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; column-gap: var(--space-s); min-width: 0; }
.left { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-xs); min-width: 0; }
.vals {
  display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; gap: var(--space-xs);
  max-width: 100%;
}
.vals > * { flex: none; white-space: nowrap; }
.tick { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; align-self: center; }
.m0 { margin: 0; }
.nt { gap: var(--space-xs); align-items: baseline; flex-wrap: wrap; }
.nt .t-capn { margin-right: var(--space-m); }
</style>
