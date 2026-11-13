<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Segmented from "../components/Segmented.vue";
import { ApiError, getProgress, ServerUnreachable, type ProgressDay, type ProgressResponse } from "../api";
import { dayMonth, spanLabel } from "../lib/dates";
import { formatDecimal, int, kg, signed } from "../lib/format";
import { screenLayoutFromFlags } from "../lib/layout";
import { fewMarks, intakeBars, intakeMax, scaleTicks, targetLine, valueY, weightTrend } from "../lib/progressChart";
import { vp } from "../lib/viewport";

const ranges = [
  { value: "7d", label: "7d", ariaLabel: "7 days" },
  { value: "30d", label: "30d", ariaLabel: "30 days" },
  { value: "90d", label: "90d", ariaLabel: "90 days" },
  { value: "6m", label: "6m", ariaLabel: "6 months" },
  { value: "all", label: "All", ariaLabel: "All" },
];
const range = ref("30d");
const data = ref<ProgressResponse | null>(null);
const loading = ref(true);
const error = ref("");
const layout = computed(() => screenLayoutFromFlags({ tablet: vp.tablet, desktop: vp.desktop, wide: vp.wide }));

const plot = { width: 320, height: 148 };

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await getProgress(range.value);
  } catch (caught) {
    data.value = null;
    error.value = caught instanceof ServerUnreachable
      ? "Server unreachable, try again."
      : caught instanceof ApiError ? caught.message : "Couldn't load progress.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void load(); });
watch(range, () => { void load(); });

const weight = computed(() => data.value?.weight ?? null);
const intake = computed(() => data.value?.intake ?? null);
const days = computed(() => data.value?.days ?? []);

const currentText = computed(() => weight.value?.currentKg == null ? "–" : `${kg(weight.value.currentKg)} kg`);
const currentNote = computed(() => {
  if (!weight.value || weight.value.currentKg == null || !weight.value.currentDate) return "No weigh-in yet";
  return dayMonth(weight.value.currentDate);
});
const changeText = computed(() => weight.value?.changeKg == null ? "–" : `${signed(weight.value.changeKg, 1)} kg`);
const changeNote = computed(() => {
  const count = weight.value?.count ?? 0;
  if (count === 0) return "No weigh-ins in this range";
  if (count === 1) return "One weigh-in, so no change";
  return "Last weigh-in minus the first";
});
const kcalText = computed(() => intake.value?.averageKcal == null ? "–" : int(intake.value.averageKcal));
const proteinText = computed(() => intake.value?.averageProtein == null ? "–" : formatDecimal(intake.value.averageProtein, 1));
const loggedText = computed(() => intake.value ? String(intake.value.loggedDays) : "–");
const loggedNote = computed(() => {
  const count = intake.value?.loggedDays ?? 0;
  if (!data.value) return "";
  const span = data.value.days.length;
  return count === 0 ? "No food logged in this range" : `of ${span} day${span === 1 ? "" : "s"} in range`;
});

const kcalDays = computed(() => days.value.map((day) => ({
  date: day.date, logged: day.logged, value: day.kcal, target: day.targetKcal,
})));
const proteinDays = computed(() => days.value.map((day) => ({
  date: day.date, logged: day.logged, value: day.protein, target: day.targetProtein,
})));
const kcalBars = computed(() => intakeBars(kcalDays.value, plot.width, plot.height));
const proteinBars = computed(() => intakeBars(proteinDays.value, plot.width, plot.height));
const kcalTarget = computed(() => targetLine(kcalDays.value, plot.width, plot.height));
const proteinTarget = computed(() => targetLine(proteinDays.value, plot.width, plot.height));
const weights = computed(() => weightTrend(
  days.value,
  weight.value?.weighIns ?? [],
  plot.width,
  plot.height,
));
const weightTicks = computed(() => weights.value.dots.length ? fewMarks(weights.value.low, weights.value.high, weights.value.flat) : []);
const kcalMax = computed(() => intakeMax(kcalDays.value));
const proteinMax = computed(() => intakeMax(proteinDays.value));
const kcalTicks = computed(() => kcalBars.value.length ? scaleTicks(0, kcalMax.value) : []);
const proteinTicks = computed(() => proteinBars.value.length ? scaleTicks(0, proteinMax.value) : []);
function weightY(mark: number) {
  return valueY(mark, weights.value.low, weights.value.high, plot.height);
}
function intakeY(mark: number, max: number) {
  return valueY(mark, 0, max, plot.height);
}
function tickTop(y: number) {
  return `${(y / plot.height) * 100}%`;
}
function axisNumber(n: number) {
  return Number.isInteger(n) ? int(n) : formatDecimal(n, 1);
}

const period = computed(() => data.value ? spanLabel(data.value.from, data.value.to) : "");
const weightLabel = computed(() => {
  const rows = weight.value?.weighIns ?? [];
  if (!rows.length) return "No weigh-ins in this range. Missing days are not filled in.";
  const list = rows.map((row) => `${dayMonth(row.date)} ${kg(row.kg)} kg`).join(", ");
  return `Weight trend, ${period.value}. Weigh-ins: ${list}. The line is the trend. Dots are logged weigh-ins. Days without a weigh-in stay blank.`;
});
function intakeLabel(kind: "Calories" | "Protein", rows: ProgressDay[], key: "kcal" | "protein", unit: string): string {
  const logged = rows.filter((day) => day.logged && day[key] != null);
  if (!logged.length) return `${kind}: no food logged in this range. Empty days are not shown as zero.`;
  const list = logged.map((day) => `${dayMonth(day.date)} ${key === "kcal" ? int(day.kcal!) : formatDecimal(day.protein!, 1)} ${unit}`).join(", ");
  return `${kind} on logged days, ${period.value}: ${list}. Days with no food are blank, not zero.`;
}
const kcalLabel = computed(() => intakeLabel("Calories", days.value, "kcal", "kcal"));
const proteinLabel = computed(() => intakeLabel("Protein", days.value, "protein", "g"));
const axisDates = computed(() => {
  const rows = days.value;
  if (!rows.length) return [];
  const mid = rows[Math.floor((rows.length - 1) / 2)];
  return [rows[0], mid, rows[rows.length - 1]].filter((day, index, all) => all.findIndex((item) => item.date === day.date) === index);
});

function retry() {
  void load();
}
function weighInOn(date: string): string {
  const row = weight.value?.weighIns.find((item) => item.date === date);
  return row ? `${kg(row.kg)} kg` : "No weigh-in";
}
</script>

<template>
  <main class="screen progress" :class="layout">
    <header class="head">
      <div class="col gap2">
        <h1 class="t-title">Progress</h1>
        <span v-if="data" class="t-label c2">{{ period }}</span>
      </div>
    </header>
    <div class="rangebar" data-range-bar>
      <Segmented v-model="range" label="Range" :options="ranges" />
    </div>

    <p v-if="loading" class="t-body c2" role="status">Loading…</p>
    <div v-else-if="error" class="card" role="alert">
      <p class="t-body">{{ error }}</p>
      <button type="button" class="chip on t-label" @click="retry">Try again</button>
    </div>
    <template v-else-if="data">
      <section class="stats" aria-label="Summary">
        <div class="stat">
          <span class="t-cap c2">Current weight</span>
          <span class="t-ns num" data-num>{{ currentText }}</span>
          <span class="t-label c2">{{ currentNote }}</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Change</span>
          <span class="t-ns num" data-num>{{ changeText }}</span>
          <span class="t-label c2">{{ changeNote }}</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Average calories</span>
          <span class="t-ns num" data-num>{{ kcalText }}</span>
          <span class="t-label c2">{{ intake?.loggedDays ? "kcal on logged days" : loggedNote }}</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Average protein</span>
          <span class="t-ns num" data-num>{{ proteinText }}</span>
          <span class="t-label c2">{{ intake?.loggedDays ? "g on logged days" : "No logged days" }}</span>
        </div>
        <div class="stat">
          <span class="t-cap c2">Logged days</span>
          <span class="t-ns num" data-num>{{ loggedText }}</span>
          <span class="t-label c2">{{ loggedNote }}</span>
        </div>
      </section>
      <p class="t-label c2 note">Averages use days you logged food. A day with no entry is left out, not treated as zero. Weight uses only saved weigh-ins.</p>

      <div class="charts">
        <section class="card chart">
          <div class="row">
            <h2 class="t-head">Weight</h2>
            <span class="grow" />
            <span class="t-capn c2">Weigh-ins</span>
          </div>
          <p v-if="!weights.dots.length" class="t-body c2">No weigh-ins in this range. Days you didn't weigh in stay blank.</p>
          <template v-else>
            <div class="plot">
            <svg :viewBox="`0 0 ${plot.width} ${plot.height}`" class="fig" role="img" :aria-label="weightLabel">
              <line v-for="mark in weightTicks" :key="mark" x1="0" :x2="plot.width" :y1="weightY(mark)" :y2="weightY(mark)" stroke="var(--text-primary)" stroke-opacity="0.08" />
              <path :d="weights.line" fill="none" stroke="var(--chart-line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              <circle v-for="dot in weights.dots" :key="dot.date" :cx="dot.x" :cy="dot.y" r="3" fill="var(--chart-line)" fill-opacity="0.3" />
            </svg>
            <div class="ylabels" aria-hidden="true">
              <span v-for="mark in weightTicks" :key="'wy' + mark" class="t-capn c2" :style="{ top: tickTop(weightY(mark)) }">{{ kg(mark) }}</span>
            </div>
            </div>
            <div class="row xlabels">
              <span v-for="day in axisDates" :key="day.date" class="t-capn c2">{{ dayMonth(day.date) }}</span>
            </div>
            <p class="t-capn c2">The line is your trend. Each dot is a weigh-in you logged.</p>
          </template>
        </section>

        <section class="card chart">
          <div class="row">
            <h2 class="t-head">Calories</h2>
            <span class="grow" />
            <span class="t-capn c2">Logged days</span>
          </div>
          <p v-if="!kcalBars.length" class="t-body c2">No food logged in this range.</p>
          <template v-else>
            <div class="plot">
            <svg :viewBox="`0 0 ${plot.width} ${plot.height}`" class="fig" role="img" :aria-label="kcalLabel">
              <line v-for="mark in kcalTicks" :key="'kg' + mark" x1="0" :x2="plot.width" :y1="intakeY(mark, kcalMax)" :y2="intakeY(mark, kcalMax)" stroke="var(--text-primary)" stroke-opacity="0.08" />
              <path v-if="kcalTarget" :d="kcalTarget" fill="none" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-dasharray="4 4" />
              <rect v-for="(bar, index) in kcalBars" :key="index" :x="bar.x - 3" :y="bar.y" width="6" :height="bar.h" fill="var(--color-action)" rx="1" />
            </svg>
            <div class="ylabels wide" aria-hidden="true">
              <span v-for="mark in kcalTicks" :key="'ky' + mark" class="t-capn c2" :style="{ top: tickTop(intakeY(mark, kcalMax)) }">{{ axisNumber(mark) }}</span>
            </div>
            </div>
            <div class="row xlabels">
              <span v-for="day in axisDates" :key="'k' + day.date" class="t-capn c2">{{ dayMonth(day.date) }}</span>
            </div>
            <p class="t-capn c2">Bars are days with food. A gap is an empty day, not zero. The dashed line is the saved calorie target.</p>
          </template>
        </section>

        <section class="card chart">
          <div class="row">
            <h2 class="t-head">Protein</h2>
            <span class="grow" />
            <span class="t-capn c2">Logged days</span>
          </div>
          <p v-if="!proteinBars.length" class="t-body c2">No food logged in this range.</p>
          <template v-else>
            <div class="plot">
            <svg :viewBox="`0 0 ${plot.width} ${plot.height}`" class="fig" role="img" :aria-label="proteinLabel">
              <line v-for="mark in proteinTicks" :key="'pg' + mark" x1="0" :x2="plot.width" :y1="intakeY(mark, proteinMax)" :y2="intakeY(mark, proteinMax)" stroke="var(--text-primary)" stroke-opacity="0.08" />
              <path v-if="proteinTarget" :d="proteinTarget" fill="none" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-dasharray="4 4" />
              <rect v-for="(bar, index) in proteinBars" :key="index" :x="bar.x - 3" :y="bar.y" width="6" :height="bar.h" fill="var(--chart-line)" rx="1" />
            </svg>
            <div class="ylabels" aria-hidden="true">
              <span v-for="mark in proteinTicks" :key="'py' + mark" class="t-capn c2" :style="{ top: tickTop(intakeY(mark, proteinMax)) }">{{ axisNumber(mark) }}</span>
            </div>
            </div>
            <div class="row xlabels">
              <span v-for="day in axisDates" :key="'p' + day.date" class="t-capn c2">{{ dayMonth(day.date) }}</span>
            </div>
            <p class="t-capn c2">Bars are days with food. A gap is an empty day, not zero. The dashed line is the saved protein target.</p>
          </template>
        </section>
      </div>

      <div class="sr-only">
      <table>
        <caption>Numbers behind the charts, {{ period }}</caption>
        <thead>
          <tr><th>Date</th><th>Weight</th><th>Calories</th><th>Protein</th><th>Calorie target</th><th>Protein target</th></tr>
        </thead>
        <tbody>
          <tr v-for="day in days" :key="day.date">
            <td>{{ dayMonth(day.date) }}</td>
            <td>{{ weighInOn(day.date) }}</td>
            <td>{{ day.logged && day.kcal != null ? int(day.kcal) + " kcal" : "No log" }}</td>
            <td>{{ day.logged && day.protein != null ? formatDecimal(day.protein, 1) + " g" : "No log" }}</td>
            <td>{{ day.targetKcal == null ? "No target" : int(day.targetKcal) + " kcal" }}</td>
            <td>{{ day.targetProtein == null ? "No target" : day.targetProtein + " g" }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </template>
  </main>
</template>

<style scoped>
.head { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 100%; }
.progress { overflow-x: clip; }
.rangebar {
  position: sticky; top: calc(var(--sat) + 8px); z-index: 2;
  background: var(--color-bg); padding: calc(var(--space-gap) / 2) 0;
}
.gap2 { gap: 2px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-width: 0; }
.stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px; border-radius: var(--radius-card); background: var(--color-surface); }
.note { margin: 0; }
.charts { display: flex; flex-direction: column; gap: var(--space-gap); min-width: 0; }
.chart { min-width: 0; }
.plot { display: flex; align-items: stretch; gap: 6px; min-width: 0; }
.fig { flex: 1 1 auto; width: auto; min-width: 0; height: auto; display: block; }
.ylabels { position: relative; width: 2.8rem; flex: none; }
.ylabels.wide { width: 3.6rem; }
.ylabels span { position: absolute; right: 0; transform: translateY(-50%); white-space: nowrap; font-variant-numeric: tabular-nums; }
.xlabels { justify-content: space-between; gap: 8px; min-width: 0; }
.head :deep(.seg), .rangebar :deep(.seg) { flex-wrap: wrap; }
.tablet .head, .two .head, .three .head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
.tablet .head :deep(.seg), .two .head :deep(.seg), .three .head :deep(.seg) { width: auto; max-width: 520px; }
.tablet .stats, .two .stats, .three .stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.two .charts, .three .charts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.two .chart:first-child, .three .chart:first-child { grid-column: 1 / -1; }
</style>
