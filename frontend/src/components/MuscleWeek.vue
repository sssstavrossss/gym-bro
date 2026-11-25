<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Bar from "./Bar.vue";
import MuscleMap from "./MuscleMap.vue";
import { getMuscles, type MusclesResponse } from "../api";
import { spanLabel } from "../lib/dates";
import { muscleLabel } from "../lib/exercises";
import { mapTones, notYet, setsText, targetLine, volumeLine, volumeStatus } from "../lib/muscleVolume";

// Progress → Strength: sets per muscle this week against the weekly target (docs/training.md, phase 4).
const data = ref<MusclesResponse | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    data.value = await getMuscles();
  } catch {
    failed.value = true;
  }
});

const rows = computed(() => {
  const week = data.value;
  if (!week) return [];
  return week.muscles.map((item) => {
    const status = volumeStatus(item.sets, week.target);
    return { ...item, name: muscleLabel(item.muscle), line: volumeLine(item, week.target), status, pct: item.sets / week.target.low };
  });
});
const tones = computed(() => (data.value ? mapTones(data.value.muscles, data.value.target) : { primary: [], secondary: [] }));
const missing = computed(() => (data.value ? notYet(data.value.muscles) : ""));
</script>

<template>
  <section class="card col week" aria-labelledby="muscle-week-title" data-muscle-week>
    <div class="col gap-2xs">
      <h2 id="muscle-week-title" class="t-head m0">This week</h2>
      <p v-if="data" class="t-capn c2 m0">{{ spanLabel(data.from, data.to) }} · {{ targetLine(data.target, data.experience) }}</p>
    </div>
    <p v-if="failed && !data" class="t-body c2 m0">Couldn't load this week's sets.</p>
    <p v-else-if="data && !rows.length" class="t-body c2 m0" data-muscle-week-empty>No sets yet this week. Workouts you log on Train count here.</p>
    <template v-else-if="data">
      <div class="layout">
      <div class="row top">
        <MuscleMap :primary="tones.primary" :secondary="tones.secondary" />
        <div class="col keys">
          <span class="t-label c2 key"><span class="dot main" aria-hidden="true" />On target</span>
          <span class="t-label c2 key"><span class="dot help" aria-hidden="true" />Under</span>
          <span class="t-label c2 key"><span class="dot idle" aria-hidden="true" />None yet</span>
        </div>
      </div>
      <ul class="col rows">
        <li v-for="row in rows" :key="row.muscle" class="mrow" :data-muscle-sets="row.muscle" :data-status="row.status">
          <span class="col mtext">
            <span class="t-body">{{ row.name }}</span>
            <span class="t-capn c2">{{ row.line }}</span>
          </span>
          <span class="t-bodys num msets" data-num>{{ setsText(row.sets) }}</span>
          <Bar class="mbar" :pct="row.pct" :hit="row.status === 'on'" :over="row.status === 'over'" />
        </li>
      </ul>
      </div>
      <p v-if="missing" class="t-capn c2 m0" data-muscle-not-yet>Not yet this week: {{ missing }}.</p>
      <p class="t-capn c2 m0">Working sets: a main muscle counts the set, a helping one half. Warm-ups, cardio and stretches don't count.</p>
    </template>
  </section>
</template>

<style scoped>
.week { min-width: 0; }
.m0 { margin: 0; }
.gap-2xs { gap: var(--space-2xs); }
/* Map beside the list where there's room, above it on a phone. */
.layout { display: flex; flex-wrap: wrap; gap: var(--space-m) var(--space-xl); align-items: flex-start; min-width: 0; }
.top { gap: var(--space-l); align-items: center; flex-wrap: wrap; flex: none; }
.keys { gap: var(--space-s); }
.key { display: flex; align-items: center; gap: var(--space-xs); }
.dot { width: var(--space-s); height: var(--space-s); border-radius: var(--radius-pill); flex: none; }
.dot.main { background: var(--muscle-main); }
.dot.help { background: var(--muscle-help); }
.dot.idle { background: var(--muscle-idle); }
.rows { list-style: none; margin: 0; padding: 0; min-width: 0; flex: 1 1 20rem; }
.mrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--space-m); row-gap: var(--space-xs); padding-block: var(--space-s); border-bottom: 1px solid var(--color-border); }
.mrow:last-child { border-bottom: 0; }
.mtext { gap: var(--space-2xs); min-width: 0; overflow-wrap: anywhere; }
.msets { font-variant-numeric: tabular-nums; }
.mbar { grid-column: 1 / -1; }
</style>
