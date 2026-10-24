<script setup lang="ts">
// S1: read-only target history, newest first. Each day uses the last row dated on or before it.
import { computed, ref } from "vue";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { reasonText, state } from "../store";
import ManualTag from "./ManualTag.vue";

const all = ref(false);
const rows = computed(() => {
  const list = [...state.history].reverse();
  // several changes on one day are merged into one row when written; older saved data may still hold several — mark those as replaced
  return list.map((r, i) => ({ ...r, replaced: i > 0 && list.slice(0, i).some((x) => x.date === r.date) }));
});
const shown = computed(() => (all.value ? rows.value : rows.value.slice(0, 5)));
</script>

<template>
  <section class="card hist" aria-labelledby="th-h">
    <div class="row"><h2 id="th-h" class="t-cap c2 m0">Target history</h2><span class="grow" /><span class="t-capn c2">read-only · newest first</span></div>
    <ol class="list">
      <li v-for="r in shown" :key="r.id" class="hrow" :class="{ replaced: r.replaced }">
        <span class="col dt"><span class="t-label">{{ dayMonth(r.date) }}</span><span class="t-capn c2">{{ weekdayShort(r.date) }}</span></span>
        <span class="col grow mid">
          <span class="t-label rl">{{ reasonText(r) }}<ManualTag v-if="r.mode === 'manual'" /><span v-if="r.replaced" class="t-capn c2"> · replaced later that day</span></span>
          <span class="t-capn c2">{{ r.note }}</span>
        </span>
        <span class="col right">
          <span class="t-bodys num">{{ int(r.kcal) }} <span class="t-capn c2">kcal</span></span>
          <span class="t-capn c2 num">P{{ r.p }} · F{{ r.f }} · C{{ r.c }}</span>
          <span v-if="r.floored" class="t-capn c2">raised to BMR</span>
          <span v-if="r.belowBmr" class="t-capn c2">below BMR, kept</span>
        </span>
      </li>
    </ol>
    <button v-if="rows.length > 5" type="button" class="more t-label" :aria-expanded="all" @click="all = !all">{{ all ? "Show fewer" : `Show all ${rows.length} changes` }}</button>
    <p class="t-capn c2 m0">Past days keep the target they had. Profile and macro changes apply from today; the trend weight updates the target every Monday.</p>
  </section>
</template>

<style scoped>
.hist { gap: 8px; }
.m0 { margin: 0; }
h2.t-cap { font: inherit; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hrow { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
.hrow:last-child { border-bottom: 0; }
.hrow.replaced .t-bodys, .hrow.replaced .t-label:first-child { text-decoration: line-through; text-decoration-color: var(--text-secondary); }
.rl { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dt { width: 52px; flex: none; gap: 1px; }
.mid { min-width: 0; gap: 2px; }
.right { align-items: flex-end; text-align: right; gap: 2px; flex: none; }
.more { align-self: flex-start; min-height: 44px; text-decoration: underline; text-underline-offset: 3px; }
/* Dynamic Type: values move under the reason at AX sizes */
.dt-xl .hrow { flex-wrap: wrap; }
.dt-xl .hrow .mid { flex: 1 1 60%; }
.dt-xl .hrow .dt { width: 100%; flex-direction: row; gap: 8px; }
.dt-xl .hrow .right { width: 100%; align-items: flex-start; text-align: left; }
</style>
