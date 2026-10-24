<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { WeightChartPoint } from "../api";
import { axisBounds, axisMarks } from "../lib/chartScale";
import { dayMonth } from "../lib/dates";
import { kg } from "../lib/format";

const props = withDefaults(defineProps<{ series: WeightChartPoint[]; height?: number; fluid?: boolean }>(), {
  height: 168,
  fluid: false,
});
const root = ref<HTMLElement | null>(null);
const measured = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!props.fluid || !root.value) return;
  observer = new ResizeObserver(([entry]) => {
    measured.value = Math.round(entry.contentRect.width);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const width = computed(() => (props.fluid && measured.value ? Math.max(200, measured.value - 40) : 290));

const data = computed(() => {
  const pts = props.series;
  const n = Math.max(pts.length, 2);
  const vals = pts.flatMap((point) => [point.weighInKg, point.trendKg]).filter((value): value is number => value != null);
  const { lo, hi, flat } = axisBounds(vals);
  const span = hi - lo || 1;
  const plotW = width.value;
  const plotH = props.height;
  const px = (index: number) => 6 + (index * (plotW - 12)) / (n - 1);
  const py = (value: number) => ((hi - value) / span) * (plotH - 12) + 6;
  const grid = axisMarks(lo, hi, flat);
  let pen = false;
  const line = pts.map((point, index) => {
    if (point.trendKg == null) {
      pen = false;
      return "";
    }
    const command = `${pen ? "L" : "M"}${px(index).toFixed(1)},${py(point.trendKg).toFixed(1)}`;
    pen = true;
    return command;
  }).join(" ");
  const lastIdx = pts.map((point) => point.trendKg != null).lastIndexOf(true);
  const tickAt = [0, 7, 14, 21, n - 1].filter((index, pos, all) => index < pts.length && all.indexOf(index) === pos);
  const ticks = tickAt.map((index) => dayMonth(pts[index].date));
  return { pts, px, py, grid, line, lastIdx, ticks };
});

const summary = computed(() => {
  const weighed = props.series.filter((point) => point.realWeighIn && point.weighInKg != null);
  const trends = props.series.filter((point) => point.trendKg != null);
  const one = (value: number) => kg(value);
  let text = `Weight, last ${props.series.length} days: ${weighed.length} weigh-in${weighed.length === 1 ? "" : "s"}`;
  if (weighed.length) {
    const values = weighed.map((point) => point.weighInKg!);
    text += `, from ${one(Math.min(...values))} to ${one(Math.max(...values))} kg`;
  }
  if (trends.length >= 2) {
    const start = trends[0].trendKg!;
    const end = trends[trends.length - 1].trendKg!;
    text += `. Trend ${one(start)} to ${one(end)} kg (${end - start <= 0 ? "down" : "up"} ${one(Math.abs(end - start))} kg)`;
  } else if (trends.length === 1) {
    text += `. Trend ${one(trends[0].trendKg!)} kg`;
  }
  const gaps = props.series.some((point) => point.gap);
  return text + (gaps ? ". The line breaks across a gap of more than 28 days." : ".");
});
</script>

<template>
  <div ref="root" class="wchart">
    <div class="row plot">
      <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="summary">
        <line v-for="mark in data.grid" :key="mark" x1="0" :x2="width" :y1="data.py(mark)" :y2="data.py(mark)" stroke="#fff" stroke-opacity="0.07" />
        <template v-for="(point, index) in data.pts" :key="point.date">
          <circle v-if="point.weighInKg != null" :cx="data.px(index)" :cy="data.py(point.weighInKg)" r="3" fill="#7DB1FF" fill-opacity="0.3" />
        </template>
        <path :d="data.line" fill="none" stroke="#7DB1FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-if="data.lastIdx >= 0" :cx="data.px(data.lastIdx)" :cy="data.py(data.pts[data.lastIdx].trendKg!)" r="4.5" fill="#7DB1FF" stroke="#26262A" stroke-width="2" />
      </svg>
      <div class="ylabels" :style="{ height: height + 'px' }">
        <span v-for="mark in data.grid" :key="mark" class="t-capn c2 ymark" :data-kg="kg(mark)" :style="{ top: data.py(mark) - 7 + 'px' }">{{ kg(mark) }}</span>
      </div>
    </div>
    <div class="row xlabels"><span v-for="tick in data.ticks" :key="tick" class="t-capn c2">{{ tick }}</span></div>
  </div>
</template>

<style scoped>
.wchart { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.plot { gap: 6px; align-items: flex-start; }
.ylabels { position: relative; flex: 1; min-width: 36px; }
.ylabels span { position: absolute; left: 0; white-space: nowrap; }
.xlabels { justify-content: space-between; gap: 8px; }
.dt-xl .plot { position: relative; }
.dt-xl .ylabels { position: absolute; inset: 0; pointer-events: none; }
.dt-xl .ylabels span { left: 4px; padding: 0 4px; border-radius: 4px; background: rgba(38, 38, 42, .85); }
.dt-xl .ylabels span:not(:first-child):not(:last-child) { display: none; }
.dt-xl .ylabels span:first-child { top: 0 !important; }
.dt-xl .ylabels span:last-child { top: auto !important; bottom: 0; }
.dt-xl .xlabels span:not(:first-child):not(:last-child) { display: none; }
</style>
