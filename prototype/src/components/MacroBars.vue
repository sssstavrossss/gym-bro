<script setup lang="ts">
import { computed } from "vue";
import Bar from "./Bar.vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { dayTotals, macroStatus, targetFor } from "../store";
const props = defineProps<{ date: string }>();
const g = computed(() => targetFor(props.date));
const t = computed(() => dayTotals(props.date));
const macros = computed(() => {
  const t = dayTotals(props.date);
  const g = targetFor(props.date);
  if (!g) return [];
  return ([
    ["kcal", "Calories", t.kcal, g.kcal, "kcal"],
    ["p", "Protein", t.p, g.p, "g"],
    ["f", "Fat", t.f, g.f, "g"],
    ["c", "Carbs", t.c, g.c, "g"],
  ] as const).map(([k, label, cur, tgt, unit]) => ({ label, cur, tgt, unit, st: macroStatus(k, cur, tgt), min: k === "p" }));
});
</script>

<template>
  <!-- Before the first target (S1): totals only, no bars and no on/off-target judgement -->
  <section v-if="!g" class="card macros notg">
    <div class="row"><span class="t-label">No target on this day</span></div>
    <p class="t-capn c2 m0">This day is before your first target, so it isn't judged or counted in on-target stats.</p>
    <div class="row nt"><span class="t-bodys">{{ int(t.kcal) }}</span><span class="t-capn c2">kcal</span><span class="t-bodys">{{ int(t.p) }}</span><span class="t-capn c2">P</span><span class="t-bodys">{{ int(t.f) }}</span><span class="t-capn c2">F</span><span class="t-bodys">{{ int(t.c) }}</span><span class="t-capn c2">C</span></div>
  </section>
  <section v-else class="card macros">
    <div v-for="m in macros" :key="m.label" class="col gap6">
      <div class="row mrow">
        <span class="t-label" :class="m.st === 'under' ? 'c2' : ''">{{ m.label }}<span v-if="m.min" class="c3 t-capn"> · min</span></span>
        <span class="grow" />
        <span class="t-bodys">{{ int(m.cur) }}</span>
        <span class="t-label c3">/ {{ int(m.tgt) }} {{ m.unit }}</span>
        <Icon v-if="m.st === 'hit'" name="check" :size="14" :sw="3" class="chk" aria-hidden="true" /><span v-if="m.st === 'hit'" class="sr-only">on target</span>
        <span v-else-if="m.st === 'over'" class="overtag t-capn">+{{ int(m.cur - m.tgt) }} over</span>
      </div>
      <Bar :pct="m.cur / m.tgt" :hit="m.st === 'hit'" :over="m.st === 'over'" :aria-label="`${m.label} ${int(m.cur)} of ${int(m.tgt)} ${m.unit}${m.st === 'hit' ? ', on target' : m.st === 'over' ? ', over' : ''}`" />
    </div>
  </section>
</template>

<style scoped>
.macros { gap: 14px; }
.gap6 { gap: 6px; }
.mrow { gap: 4px; align-items: baseline; }
.chk { align-self: center; }
.m0 { margin: 0; }
.nt { gap: 4px; align-items: baseline; flex-wrap: wrap; }
.nt .t-capn { margin-right: 10px; }
.overtag { align-self: center; padding: 1px 6px; border-radius: 6px; border: 1px dashed var(--text-secondary); color: var(--text-secondary); margin-left: 2px; }
</style>
