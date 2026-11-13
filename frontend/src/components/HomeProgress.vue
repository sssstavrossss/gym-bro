<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { ApiError, getProgress, ServerUnreachable, type ProgressResponse } from "../api";
import { dayMonth, spanLabel } from "../lib/dates";
import { int, kg, signed } from "../lib/format";
import { fewMarks, intakeBars, intakeMax, slotX, targetLine, valueY, weightTrend } from "../lib/progressChart";
import { profile } from "../state/profile";
import { openWeight, toast } from "../ui";

const props = defineProps<{ selected: string }>();

const metricKey = "gymbro-home-metric";
const rangeKey = "gymbro-home-range";
const metrics = ["weight", "kcal", "protein", "fat", "carbs"] as const;
const ranges = ["7d", "30d", "90d", "6m", "all"] as const;
type Metric = (typeof metrics)[number];
type Range = (typeof ranges)[number];

const metricLabels: Record<Metric, string> = {
  weight: "Weight",
  kcal: "kcal",
  protein: "Protein",
  fat: "Fat",
  carbs: "Carbs",
};
const rangeLabels: Record<Range, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  "6m": "6m",
  all: "All",
};

function readMetric(): Metric {
  try {
    const stored = localStorage.getItem(metricKey);
    if (stored && (metrics as readonly string[]).includes(stored)) return stored as Metric;
  } catch {
    // Private mode can reject storage. Weight is the default either way.
  }
  return "weight";
}
function readRange(): Range {
  try {
    const stored = localStorage.getItem(rangeKey);
    if (stored && (ranges as readonly string[]).includes(stored)) return stored as Range;
  } catch {
    // 30d is the default either way.
  }
  return "30d";
}

const metric = ref<Metric>(readMetric());
const range = ref<Range>(readRange());
const data = ref<ProgressResponse | null>(null);
const failed = ref(false);
let requestId = 0;

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The pick still applies for this visit.
  }
}

async function load() {
  const id = ++requestId;
  const asked = range.value;
  failed.value = false;
  try {
    const next = await getProgress(asked);
    if (id !== requestId || asked !== range.value) return;
    data.value = next;
  } catch (error) {
    if (id !== requestId) return;
    failed.value = data.value == null;
    if (error instanceof ServerUnreachable) toast("Server unreachable, try again.");
    else if (error instanceof ApiError) toast(error.message);
  }
}

function pickMetric(value: Metric) {
  metric.value = value;
  remember(metricKey, value);
}
function pickRange(value: Range) {
  if (value === range.value) return;
  range.value = value;
  remember(rangeKey, value);
  void load();
}

onMounted(() => { void load(); });
watch(
  () => `${profile.weight?.latestDate ?? ""}:${profile.weight?.latestKg ?? ""}:${profile.weight?.trendKg ?? ""}`,
  () => { void load(); },
);

const days = computed(() => data.value?.days ?? []);
const period = computed(() => data.value ? spanLabel(data.value.from, data.value.to) : "");
const plot = { width: 320, height: 168 };
const dotRadius = computed(() => range.value === "6m" || range.value === "all" ? 2 : 3);

const weights = computed(() => weightTrend(
  days.value,
  data.value?.weight.weighIns ?? [],
  plot.width,
  plot.height,
));
const weightTicks = computed(() => fewMarks(weights.value.low, weights.value.high, weights.value.flat));

function intakeOf(kind: Exclude<Metric, "weight">) {
  return days.value.map((day) => {
    const value = kind === "kcal" ? day.kcal : kind === "protein" ? day.protein : kind === "fat" ? day.fat : day.carbs;
    const target = kind === "kcal" ? day.targetKcal : kind === "protein" ? day.targetProtein : kind === "fat" ? day.targetFat : day.targetCarbs;
    return { date: day.date, logged: day.logged, value: value ?? null, target: target ?? null };
  });
}
const intake = computed(() => metric.value === "weight" ? [] : intakeOf(metric.value));
const bars = computed(() => intakeBars(intake.value, plot.width, plot.height));
const goalLine = computed(() => targetLine(intake.value, plot.width, plot.height));
const intakeHigh = computed(() => intakeMax(intake.value));
const intakeTicks = computed(() => fewMarks(0, intakeHigh.value));

function yOf(value: number, high: number) {
  return valueY(value, 0, high, plot.height);
}
function weightY(value: number) {
  return valueY(value, weights.value.low, weights.value.high, plot.height);
}
const yLabels = computed(() => {
  if (metric.value === "weight") {
    return weightTicks.value.map((mark) => ({
      key: `w${mark}`,
      top: `${(weightY(mark) / plot.height) * 100}%`,
      text: kg(mark),
    }));
  }
  return intakeTicks.value.map((mark) => ({
    key: `i${mark}`,
    top: `${(yOf(mark, intakeHigh.value) / plot.height) * 100}%`,
    text: int(mark),
  }));
});

const marker = computed(() => {
  const index = days.value.findIndex((day) => day.date === props.selected);
  if (index < 0) return null;
  return slotX(index, days.value.length, plot.width);
});

const axis = computed(() => {
  const list = days.value;
  if (!list.length) return [];
  const picks = list.length === 1 ? [0] : [0, Math.floor((list.length - 1) / 2), list.length - 1];
  return [...new Set(picks)].map((index) => list[index]);
});

const lastTrend = computed(() => {
  for (let index = days.value.length - 1; index >= 0; index -= 1) {
    const value = days.value[index].trendKg;
    if (value != null) return value;
  }
  return null;
});
const endTarget = computed(() => {
  for (let index = days.value.length - 1; index >= 0; index -= 1) {
    const day = days.value[index];
    if (day.targetKcal != null || day.targetProtein != null) return day;
  }
  return null;
});

const trendText = computed(() => lastTrend.value == null ? "–" : `${kg(lastTrend.value)} kg`);
const latestText = computed(() => {
  const kgValue = data.value?.weight.currentKg;
  return kgValue == null ? "no weigh-in" : `latest ${kg(kgValue)}`;
});
const changeText = computed(() => {
  const value = data.value?.weight.trendChangeKg;
  return value == null ? "–" : `${signed(value)} kg`;
});
const sinceText = computed(() => data.value ? `since ${dayMonth(data.value.from)}` : "");
const calorieText = computed(() => {
  const value = data.value?.intake.averageKcal;
  return value == null ? "–" : int(value);
});
const calorieTarget = computed(() => {
  const target = endTarget.value?.targetKcal;
  return target == null ? "no target" : `of ${int(target)}`;
});
const proteinText = computed(() => {
  const value = data.value?.intake.averageProtein;
  return value == null ? "–" : `${int(value)} g`;
});
const proteinTarget = computed(() => {
  const target = endTarget.value?.targetProtein;
  return target == null ? "no minimum" : `min ${int(target)}`;
});

function stopScroll(event: MouseEvent) {
  event.preventDefault();
}
</script>

<template>
  <section class="home-progress" aria-label="Progress">
    <div class="row head">
      <h2 class="t-head">Progress</h2>
      <span v-if="period" class="t-label c2 period">{{ period }}</span>
      <span class="grow" />
      <button type="button" class="weigh" @click="openWeight()">
        <Icon name="scale" :size="16" />
        <span class="t-label">Weigh in</span>
      </button>
    </div>

    <div class="pickers">
      <div class="picker-row" role="radiogroup" aria-label="Chart metric" @mousedown="stopScroll">
        <button v-for="item in metrics" :key="item" type="button" role="radio" class="pill t-label"
          :class="{ on: metric === item }" :aria-checked="metric === item" @click="pickMetric(item)">{{ metricLabels[item] }}</button>
      </div>
      <div class="picker-row" role="radiogroup" aria-label="Chart range" @mousedown="stopScroll">
        <button v-for="item in ranges" :key="item" type="button" role="radio" class="quiet-pill t-label"
          :class="{ on: range === item }" :aria-checked="range === item" @click="pickRange(item)">{{ rangeLabels[item] }}</button>
      </div>
    </div>

    <section class="card chart" :aria-label="metricLabels[metric]">
      <div class="row">
        <h3 class="t-head">{{ metricLabels[metric] }}</h3>
        <span class="grow" />
        <span class="t-capn c2">{{ metric === "weight" ? "Line = trend · dots = weigh-ins" : "Bars = logged days · dashed = target" }}</span>
      </div>
      <p v-if="!data && !failed" class="t-body c2">Loading progress…</p>
      <p v-else-if="failed && !data" class="t-body c2">Progress couldn't be loaded.</p>
      <p v-else-if="metric === 'weight' && !weights.dots.length && !weights.line" class="t-body c2">No weigh-ins in this range.</p>
      <p v-else-if="metric !== 'weight' && !bars.length && !goalLine" class="t-body c2">No food logged in this range.</p>
      <template v-else>
        <div class="plot">
          <svg :viewBox="`0 0 ${plot.width} ${plot.height}`" class="fig" role="img" :aria-label="`${metricLabels[metric]} chart`">
            <template v-if="metric === 'weight'">
              <line v-for="mark in weightTicks" :key="mark" x1="0" :x2="plot.width" :y1="weightY(mark)" :y2="weightY(mark)" stroke="var(--text-primary)" stroke-opacity="0.08" />
              <path :d="weights.line" fill="none" stroke="var(--chart-line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              <circle v-for="dot in weights.dots" :key="dot.date" :cx="dot.x" :cy="dot.y" :r="dotRadius" fill="var(--chart-line)" fill-opacity="0.35" />
            </template>
            <template v-else>
              <line v-for="mark in intakeTicks" :key="mark" x1="0" :x2="plot.width" :y1="yOf(mark, intakeHigh)" :y2="yOf(mark, intakeHigh)" stroke="var(--text-primary)" stroke-opacity="0.08" />
              <path v-if="goalLine" :d="goalLine" fill="none" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-dasharray="4 4" />
              <rect v-for="(bar, index) in bars" :key="index" :x="bar.x - 3" :y="bar.y" width="6" :height="bar.h" fill="var(--chart-line)" rx="1" />
            </template>
            <line v-if="marker != null" :x1="marker" :x2="marker" y1="0" :y2="plot.height" stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="2 3" />
          </svg>
          <div class="ylabs" aria-hidden="true">
            <span v-for="label in yLabels" :key="label.key" class="ylab" :style="{ top: label.top }">{{ label.text }}</span>
          </div>
        </div>
        <div class="row xlabels">
          <span v-for="day in axis" :key="day.date" class="t-capn c2">{{ dayMonth(day.date) }}</span>
        </div>
      </template>
    </section>

    <section v-if="data" class="card sum" aria-label="Summary" data-home-summary>
      <div class="cells">
        <div class="cell">
          <span class="t-cap c2">Trend</span>
          <span class="num" data-num>{{ trendText }}</span>
          <span class="t-capn c2">{{ latestText }}</span>
        </div>
        <div class="cell">
          <span class="t-cap c2">Change</span>
          <span class="num" data-num>{{ changeText }}</span>
          <span class="t-capn c2">{{ sinceText }}</span>
        </div>
        <div class="cell">
          <span class="t-cap c2">Calories</span>
          <span class="num" data-num>{{ calorieText }}</span>
          <span class="t-capn c2">{{ calorieTarget }}</span>
        </div>
        <div class="cell">
          <span class="t-cap c2">Protein</span>
          <span class="num" data-num>{{ proteinText }}</span>
          <span class="t-capn c2">{{ proteinTarget }}</span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.home-progress { display: flex; flex-direction: column; gap: var(--space-gap); min-width: 0; }
.head { gap: calc(var(--space-gap) / 2); min-width: 0; align-items: center; }
.period { min-width: 0; white-space: nowrap; }
.weigh {
  min-width: 44px; min-height: 44px; padding: 0 var(--space-gap);
  display: inline-flex; align-items: center; justify-content: center; gap: calc(var(--space-gap) / 2);
  border-radius: 12px; background: var(--color-surface-2); color: var(--text-primary); flex: none;
}
.pickers { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); min-width: 0; width: 100%; }
.picker-row {
  display: flex; flex-wrap: nowrap; gap: calc(var(--space-gap) / 2);
  width: 100%; min-width: 0;
}
.pill, .quiet-pill {
  flex: 1 1 0; min-width: 0; min-height: 44px; padding: 0 2px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 22px; color: var(--text-secondary); white-space: nowrap;
}
.pill { background: var(--color-surface-2); }
.pill.on { background: var(--color-action); color: var(--color-on-action); }
.quiet-pill.on { background: var(--color-surface-2); color: var(--text-primary); box-shadow: inset 0 0 0 1.5px var(--color-border-strong); }
.chart { min-width: 0; min-height: 220px; }
.plot { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 40px; align-items: stretch; }
.fig { width: 100%; height: auto; display: block; }
.ylabs { position: relative; }
.ylab {
  position: absolute; right: 0; transform: translateY(-50%);
  font-size: min(0.6471rem, 15px); line-height: 1; color: var(--text-tertiary); white-space: nowrap;
}
.xlabels { justify-content: space-between; gap: var(--space-gap); min-width: 0; }
.sum { gap: 0; }
.cells { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: calc(var(--space-gap) / 2); }
.cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cell + .cell { border-left: 1px solid var(--color-border); padding-left: calc(var(--space-gap) / 2); }
.num { font-size: min(1rem, 18px); line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; }
.cell .num, .cell .t-capn { overflow-wrap: anywhere; }
.dt-xl .cells { grid-template-columns: 1fr 1fr; }
.dt-xl .cell:nth-child(odd) { border-left: 0; padding-left: 0; }
</style>
