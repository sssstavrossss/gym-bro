<script setup lang="ts">
import { computed } from "vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { macroStatus, type MacroKind } from "../lib/macros";
import { dayTotals } from "../state/log";
import { profile } from "../state/profile";

const target = computed(() => profile.targets);
const totals = computed(() => dayTotals());
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
  <section v-else class="card macros" aria-label="Today's macros">
    <div v-for="m in macros" :key="m.label" class="col gap6">
      <div class="row mrow">
        <span class="t-label" :class="m.st === 'under' ? 'c2' : ''">{{ m.label }}<span v-if="m.min" class="c3 t-capn"> · min</span></span>
        <span class="grow" />
        <span class="t-bodys" data-num>{{ int(m.cur) }}</span>
        <span class="t-label c3">/ {{ int(m.tgt) }} {{ m.unit }}</span>
        <Icon v-if="m.st === 'hit'" name="check" :size="14" :sw="3" aria-hidden="true" />
        <span v-if="m.st === 'hit'" class="sr-only">on target</span>
        <span v-else-if="m.st === 'over'" class="overtag t-capn">+{{ int(m.cur - m.tgt) }} over</span>
      </div>
      <Bar :pct="m.tgt ? m.cur / m.tgt : 0" :hit="m.st === 'hit'" :over="m.st === 'over'" :aria-label="`${m.label} ${int(m.cur)} of ${int(m.tgt)} ${m.unit}${m.st === 'hit' ? ', on target' : m.st === 'over' ? ', over' : ''}`" />
    </div>
  </section>
</template>

<style scoped>
.macros { gap: 14px; }
.gap6 { gap: 6px; }
.mrow { gap: 4px; align-items: baseline; min-width: 0; }
.m0 { margin: 0; }
.nt { gap: 4px; align-items: baseline; flex-wrap: wrap; }
.nt .t-capn { margin-right: 10px; }
.overtag { align-self: center; padding: 1px 6px; border-radius: 6px; border: 1px dashed var(--text-secondary); color: var(--text-secondary); margin-left: 2px; white-space: nowrap; }
</style>
