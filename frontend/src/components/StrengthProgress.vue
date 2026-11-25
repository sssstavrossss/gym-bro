<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import MuscleWeek from "./MuscleWeek.vue";
import { ApiError, getStrength, ServerUnreachable, type StrengthResponse } from "../api";
import { dayMonth, spanLabel } from "../lib/dates";
import { maxText } from "../lib/records";
import { changeLine, liftsUp, sparkline } from "../lib/strength";
import { exercises, loadExercises } from "../state/exercises";

// Progress → Strength (docs/training.md, phase 4): workouts and sets in the range, then each lift's estimated max.
const props = defineProps<{ range: string }>();
/** The dates shown, for the page's header. */
const emit = defineEmits<{ period: [string] }>();

/** Lifts shown before Show all. */
const FIRST = 8;
const spark = { width: 96, height: 32 };

const data = ref<StrengthResponse | null>(null);
const loading = ref(true);
const error = ref("");
const showAll = ref(false);
let requestId = 0;

async function load() {
  const token = ++requestId;
  if (!data.value) loading.value = true;
  error.value = "";
  try {
    const next = await getStrength(props.range);
    if (token === requestId) data.value = next;
  } catch (caught) {
    if (token !== requestId || data.value) return;
    error.value = caught instanceof ServerUnreachable
      ? "Strength isn't on this phone yet. It loads when you're back online."
      : caught instanceof ApiError ? caught.message : "Couldn't load strength.";
  } finally {
    if (token === requestId) loading.value = false;
  }
}

onMounted(() => {
  void load();
  if (!exercises.items.length) void loadExercises();
});
watch(() => props.range, () => void load());

const nameOf = (id: string) => exercises.items.find((item) => item.id === id)?.name ?? id;
const period = computed(() => (data.value ? spanLabel(data.value.from, data.value.to) : ""));
watch(period, (value) => emit("period", value), { immediate: true });
const lifts = computed(() => (data.value?.lifts ?? []).map((lift) => ({
  ...lift,
  name: nameOf(lift.exerciseId),
  line: changeLine(lift),
  spark: sparkline(lift.points, spark.width, spark.height),
})));
const shown = computed(() => (showAll.value ? lifts.value : lifts.value.slice(0, FIRST)));
const up = computed(() => liftsUp(data.value?.lifts ?? []));
</script>

<template>
  <div class="col strength">
    <p v-if="loading && !data" class="t-body c2" role="status">Loading…</p>
    <div v-else-if="error && !data" class="card" role="alert">
      <p class="t-body">{{ error }}</p>
      <button type="button" class="btn sm primary t-label" @click="load"><Icon name="refresh" :size="14" /> Try again</button>
    </div>
    <template v-if="data">
      <section class="stats" aria-label="Training summary" data-strength-stats>
        <div class="stat">
          <span class="t-cap c2">Workouts</span>
          <span class="t-ns num" data-num>{{ data.workouts }}</span>
          <span class="t-label c2">done in this range</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Sets</span>
          <span class="t-ns num" data-num>{{ data.sets }}</span>
          <span class="t-label c2">not counting warm-ups</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Lifts up</span>
          <span class="t-ns num" data-num>{{ up.of ? up.up : "–" }}</span>
          <span class="t-label c2">{{ up.of ? `of ${up.of} done on 2 days or more` : "Needs a lift done on 2 days" }}</span>
        </div>
      </section>

      <section class="card col lifts" aria-labelledby="strength-max-title" data-strength-lifts>
        <h2 id="strength-max-title" class="t-head m0">Estimated max</h2>
        <p v-if="!lifts.length" class="t-body c2 m0">No lifts with a weight in this range. Workouts you log on Train show here.</p>
        <ul v-else class="col rows">
          <li v-for="lift in shown" :key="lift.exerciseId" class="row lrow" :data-lift="lift.exerciseId">
            <span class="col grow ltext">
              <span class="t-body">{{ lift.name }}</span>
              <span class="t-capn c2">{{ lift.line }}</span>
            </span>
            <span class="t-bodys num lmax" data-num>{{ maxText(lift.current) }}</span>
            <svg v-if="lift.spark" class="spark" :viewBox="`0 0 ${spark.width} ${spark.height}`" aria-hidden="true">
              <path v-if="lift.points.length > 1" :d="lift.spark.d" fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <circle :cx="lift.spark.x" :cy="lift.spark.y" r="3" fill="var(--chart-line)" />
            </svg>
          </li>
        </ul>
        <button v-if="lifts.length > FIRST" type="button" class="btn sm secondary t-label more" @click="showAll = !showAll">
          {{ showAll ? "Show fewer" : `Show all ${lifts.length}` }}
        </button>
        <p v-if="lifts.length" class="t-capn c2 m0">Each day's best set, as kg × (1 + (reps + reps in reserve) / 30). The line runs from the first day in the range to the last.</p>
      </section>

      <MuscleWeek />

      <div class="sr-only">
        <table>
          <caption>Estimated max by day, {{ period }}</caption>
          <thead><tr><th>Lift</th><th>Date</th><th>Best set</th><th>Estimated max</th></tr></thead>
          <tbody>
            <template v-for="lift in lifts" :key="'t' + lift.exerciseId">
              <tr v-for="point in lift.points" :key="lift.exerciseId + point.date">
                <td>{{ lift.name }}</td>
                <td>{{ dayMonth(point.date) }}</td>
                <td>{{ point.kg }} kg × {{ point.reps }}</td>
                <td>{{ maxText(point.estimatedMax) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.strength { gap: var(--space-m); min-width: 0; }
.m0 { margin: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: var(--space-m); min-width: 0; }
.stat { display: flex; flex-direction: column; gap: var(--space-2xs); min-width: 0; padding: var(--space-m); border-radius: var(--radius-l); background: var(--color-surface); box-shadow: var(--d-card); }
.lifts { min-width: 0; }
.rows { list-style: none; margin: 0; padding: 0; min-width: 0; }
.lrow { gap: var(--space-m); padding-block: var(--space-s); border-bottom: 1px solid var(--color-border); flex-wrap: nowrap; align-items: center; min-width: 0; }
.lrow:last-child { border-bottom: 0; }
.ltext { gap: var(--space-2xs); min-width: 0; overflow-wrap: anywhere; }
.lmax { flex: none; font-variant-numeric: tabular-nums; }
.spark { flex: none; width: 96px; height: 32px; display: block; }
.more { align-self: flex-start; }
.dt-xl .lrow { flex-wrap: wrap; }
</style>
