<script setup lang="ts">
// Last 30 days: faint dots = weigh-ins, solid line = smoothed trend. Blue is the only colour in the app.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { addDays, dayMonth } from "../lib/dates";
import { state, trendPlot } from "../store";

const props = withDefaults(defineProps<{ end: string; days?: number; width?: number; height?: number; fluid?: boolean }>(), { days: 30, width: 290, height: 168 });
// fluid: fill the container width (tablet/desktop); otherwise the fixed Figma size.
const root = ref<HTMLElement | null>(null);
const measured = ref(0);
let ro: ResizeObserver | undefined;
onMounted(() => {
  if (!props.fluid || !root.value) return;
  ro = new ResizeObserver(([e]) => (measured.value = Math.round(e.contentRect.width)));
  ro.observe(root.value);
});
onBeforeUnmount(() => ro?.disconnect());
const W = computed(() => (props.fluid && measured.value ? Math.max(200, measured.value - 40) : props.width));


const data = computed(() => {
  const n = props.days;
  const dates = Array.from({ length: n }, (_, i) => addDays(props.end, i - (n - 1)));
  // S8: the trend line from the first weigh-in on; broken across a fresh-start gap (more than 28 days)
  const pts = dates.map((d) => ({ d, w: state.weights[d], t: trendPlot(d) }));
  const vals = pts.flatMap((p) => [p.w, p.t]).filter((v): v is number => v != null);
  if (!vals.length) vals.push(state.profile.startWeight);
  const lo = Math.floor((Math.min(...vals) - 0.15) * 2) / 2;
  const hi = Math.ceil((Math.max(...vals) + 0.15) * 2) / 2;
  const Wd = W.value, H = props.height;
  const px = (i: number) => 6 + (i * (Wd - 12)) / (n - 1);
  const py = (w: number) => ((hi - w) / (hi - lo)) * (H - 12) + 6;
  const grid: number[] = [];
  const step = hi - lo > 3 ? 1 : 0.5;
  for (let g = hi - step; g > lo + 1e-9; g -= step) grid.push(Math.round(g * 10) / 10);
  let pen = false;
  const line = pts.map((p, i) => { if (p.t == null) { pen = false; return ""; } const s = `${pen ? "L" : "M"}${px(i).toFixed(1)},${py(p.t).toFixed(1)}`; pen = true; return s; }).join(" ");
  const lastIdx = pts.map((p) => p.t != null).lastIndexOf(true);
  const ticks = [0, 7, 14, 21, n - 1].filter((i) => i < n).map((i) => dayMonth(dates[i]));
  return { pts, px, py, grid, line, lastIdx, ticks, lo, hi };
});
/** S5: a text summary of the chart for screen readers */
const summary = computed(() => {
  const ps = data.value.pts;
  const ws = ps.filter((p) => p.w != null);
  const ts = ps.filter((p) => p.t != null);
  const f = (n: number) => n.toFixed(1);
  let txt = `Weight, last ${props.days} days: ${ws.length} weigh-in${ws.length === 1 ? "" : "s"}`;
  if (ws.length) txt += `, from ${f(Math.min(...ws.map((p) => p.w!)))} to ${f(Math.max(...ws.map((p) => p.w!)))} kg`;
  if (ts.length >= 2) { const a = ts[0].t!, b = ts[ts.length - 1].t!; txt += `. Trend ${f(a)} to ${f(b)} kg (${b - a <= 0 ? "down" : "up"} ${f(Math.abs(b - a))} kg)`; }
  else if (ts.length === 1) txt += `. Trend ${f(ts[0].t!)} kg`;
  return txt + ".";
});
</script>

<template>
  <div ref="root" class="wchart">
    <div class="row plot">
      <svg :width="W" :height="height" :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="summary">
        <line v-for="g in data.grid" :key="g" x1="0" :x2="W" :y1="data.py(g)" :y2="data.py(g)" stroke="#fff" stroke-opacity="0.07" />
        <template v-for="(p, i) in data.pts" :key="p.d">
          <circle v-if="p.w != null" :cx="data.px(i)" :cy="data.py(p.w)" r="3" fill="#7DB1FF" fill-opacity="0.3" />
        </template>
        <path :d="data.line" fill="none" stroke="#7DB1FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-if="data.lastIdx >= 0" :cx="data.px(data.lastIdx)" :cy="data.py(data.pts[data.lastIdx].t!)" r="4.5" fill="#7DB1FF" stroke="#26262A" stroke-width="2" />
      </svg>
      <div class="ylabels" :style="{ height: height + 'px' }">
        <span v-for="g in data.grid" :key="g" class="t-capn c3" :style="{ top: data.py(g) - 7 + 'px' }">{{ g.toFixed(1) }}</span>
      </div>
    </div>
    <div class="row xlabels"><span v-for="t in data.ticks" :key="t" class="t-capn c3">{{ t }}</span></div>
  </div>
</template>

<style scoped>
.wchart { display: flex; flex-direction: column; gap: 10px; }
.plot { gap: 6px; align-items: flex-start; }
.ylabels { position: relative; flex: 1; }
.ylabels span { position: absolute; left: 0; }
.xlabels { justify-content: space-between; }
/* Dynamic Type: the plot keeps its size; at AX sizes only the top and bottom values are labelled, inside the plot */
.dt-xl .plot { position: relative; }
.dt-xl .ylabels { position: absolute; inset: 0; pointer-events: none; }
.dt-xl .ylabels span { left: 4px; padding: 0 4px; border-radius: 4px; background: rgba(38, 38, 42, .85); }
.dt-xl .ylabels span:not(:first-child):not(:last-child) { display: none; }
.dt-xl .ylabels span:first-child { top: 0 !important; }
.dt-xl .ylabels span:last-child { top: auto !important; bottom: 0; }
.dt-xl .xlabels span:not(:first-child):not(:last-child) { display: none; }
</style>
