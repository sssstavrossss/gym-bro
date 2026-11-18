<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import type { ProgressDay } from "../api";
import { axisBounds } from "../lib/chartScale";
import { dayMonth } from "../lib/dates";
import { formatDecimal, int } from "../lib/format";
import { kgTo } from "../lib/units";
import { weightUnit } from "../state/units";
import { evenAxisLabels, valueY, type IntakeDay } from "../lib/progressChart";
import { trendExtent, trendShapes, type TrendSample } from "../lib/weightTrend";
import { barWidth, chartLayout, intakeScale, isMinimum, monthTicks, targetSteps, visibleSpan, type ProgressPage } from "../lib/progressCard";

/**
 * One page of the Home Progress card. Drawn at the exact pixel width, so text and bars never stretch.
 * "All" past six months is drawn at the 6-month scale and scrolls sideways inside the chart;
 * the y labels stay put and both edges fade while there is more to see.
 */
const props = defineProps<{
  page: ProgressPage;
  title: string;
  range: string;
  days: ProgressDay[];
  intake: IntakeDay[];
  weighIns: { date: string; kg: number }[];
  selected: string;
  unit: string;
  /** Pixels from the right end, shared by every page so a swipe keeps the same stretch of time. */
  pan: number;
  /** Weight page: a weight being typed (kg), drawn as a hollow dot on the selected day. */
  preview?: number | null;
}>();
const emit = defineEmits<{ "update:pan": [value: number]; span: [value: { from: string; to: string } | null] }>();

const H = 140;
const LABELS = 20;
const uid = useId();
const view = ref<HTMLElement | null>(null);
const viewWidth = ref(0);
const scrollLeft = ref(0);

const layout = computed(() => chartLayout(props.range, props.days.length, viewWidth.value));
const W = computed(() => layout.value.contentWidth);
const n = computed(() => props.days.length);
const slot = computed(() => (n.value ? W.value / n.value : 0));
function xAt(index: number) {
  return (index + 0.5) * slot.value;
}

// Weight, in the shown unit, so the axis steps work in pounds the way they do in kilograms.
const shownWeighIns = computed(() => props.weighIns.map((row) => ({ date: row.date, value: kgTo(row.kg, weightUnit()) })));
const trendSamples = computed<TrendSample[]>(() => props.days.map((day) => ({
  trend: day.trendKg == null ? null : kgTo(day.trendKg, weightUnit()),
  band: day.trendBandKg == null ? null : kgTo(day.trendBandKg, weightUnit()),
  measured: day.trendMeasured ?? false,
})));
const weightScale = computed(() => {
  const values = [...shownWeighIns.value.map((row) => row.value), ...trendExtent(trendSamples.value)];
  return values.length ? axisBounds(values) : null;
});
function wy(value: number) {
  const scale = weightScale.value;
  return scale ? valueY(value, scale.lo, scale.hi, H) : H;
}
const shapes = computed(() => trendShapes(trendSamples.value, xAt, wy));
const weightDots = computed(() => {
  const index = new Map(props.days.map((day, i) => [day.date, i]));
  return shownWeighIns.value.flatMap((row) => {
    const i = index.get(row.date);
    return i == null ? [] : [{ key: row.date, x: xAt(i), y: wy(row.value) }];
  });
});
const dotRadius = computed(() => (slot.value < 2.5 ? 1.6 : slot.value < 8 ? 2.2 : 2.8));
const lastTrend = computed(() => {
  for (let i = trendSamples.value.length - 1; i >= 0; i -= 1) {
    const value = trendSamples.value[i].trend;
    if (value != null) return { x: xAt(i), y: wy(value), text: formatDecimal(value) };
  }
  return null;
});
const weightTicks = computed(() => {
  const scale = weightScale.value;
  return scale ? evenAxisLabels(scale.lo, scale.hi, scale.flat) : [];
});

// Intake
const minimum = computed(() => isMinimum(props.page));
const scale = computed(() => {
  const values = props.intake.flatMap((day) => (day.logged && day.value != null ? [day.value] : []));
  const targets = props.intake.flatMap((day) => (day.target != null ? [day.target] : []));
  return intakeScale(Math.max(0, ...values, ...targets));
});
function iy(value: number) {
  return valueY(value, 0, scale.value.top, H);
}
const bw = computed(() => barWidth(W.value, n.value));
const bars = computed(() => props.intake.flatMap((day, index) => {
  if (!day.logged || day.value == null || day.value <= 0) return [];
  const y = iy(day.value);
  const off = day.target != null && (minimum.value ? day.value < day.target : day.value > day.target * 1.1);
  return [{ key: day.date, x: xAt(index) - bw.value / 2, y, h: Math.max(1, iy(0) - y), off }];
}));
const steps = computed(() => targetSteps(props.intake).map((step) => ({
  x1: step.from * slot.value,
  x2: (step.to + 1) * slot.value,
  y: iy(step.value),
  value: step.value,
})));
const stepLabel = computed(() => {
  const last = steps.value[steps.value.length - 1];
  if (!last) return null;
  const text = `${minimum.value ? "min" : "target"} ${int(last.value)}${props.unit ? ` ${props.unit}` : ""}`;
  const width = text.length * 5.6 + 8;
  return { text, x: Math.max(width, last.x2 - 2), y: last.y - 5, width };
});

// Axes
const yLabels = computed(() => {
  if (props.page === "weight") return weightTicks.value.map((mark) => ({ key: `w${mark}`, top: wy(mark), text: formatDecimal(mark) }));
  return scale.value.ticks.map((mark) => ({ key: `i${mark}`, top: iy(mark), text: int(mark) }));
});
const gridLines = computed(() => yLabels.value.map((label) => label.top));
const xLabels = computed(() => {
  const list = props.days;
  if (!list.length || W.value <= 0) return [];
  if (props.range === "6m" || props.range === "all") {
    return monthTicks(list.map((day) => day.date), W.value).map((tick) => ({ key: tick.text + tick.index, x: xAt(tick.index), text: tick.text, anchor: "middle" }));
  }
  const last = list.length - 1;
  const picks = last === 0 ? [0] : [0, Math.floor(last / 2), last];
  return [...new Set(picks)].map((index, i, all) => ({
    key: list[index].date,
    x: i === 0 ? 0 : i === all.length - 1 && all.length > 1 ? W.value : xAt(index),
    text: dayMonth(list[index].date),
    anchor: i === 0 ? "start" : i === all.length - 1 && all.length > 1 ? "end" : "middle",
  }));
});
const marker = computed(() => {
  const index = props.days.findIndex((day) => day.date === props.selected);
  return index < 0 ? null : xAt(index);
});

const previewDot = computed(() => {
  if (props.page !== "weight" || props.preview == null || marker.value == null || !weightScale.value) return null;
  // Kept inside the plot, so a value far off the scale does not rescale the chart while you type.
  const y = Math.min(H - 5, Math.max(5, wy(kgTo(props.preview, weightUnit()))));
  return { x: marker.value, y };
});

const empty = computed(() => {
  if (props.page === "weight") return weightScale.value ? "" : "No weigh-ins in this range.";
  return bars.value.length || steps.value.length ? "" : "Nothing logged in this range.";
});

// Scrolling ("All" past six months)
const maxScroll = computed(() => Math.max(0, W.value - viewWidth.value));
const fadeLeft = computed(() => layout.value.scrollable && scrollLeft.value > 1);
const fadeRight = computed(() => layout.value.scrollable && scrollLeft.value < maxScroll.value - 1);
let frame = 0;
function onScroll() {
  const el = view.value;
  if (!el) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    scrollLeft.value = el.scrollLeft;
    if (!layout.value.scrollable) return;
    emit("update:pan", Math.round(maxScroll.value - el.scrollLeft));
    emit("span", visibleSpan(props.days.map((day) => day.date), el.scrollLeft, viewWidth.value, W.value));
  });
}
function place() {
  const el = view.value;
  if (!el) return;
  if (!layout.value.scrollable) {
    el.scrollLeft = 0;
    scrollLeft.value = 0;
    return;
  }
  const target = Math.max(0, Math.min(maxScroll.value, maxScroll.value - props.pan));
  if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
  scrollLeft.value = el.scrollLeft;
  emit("span", visibleSpan(props.days.map((day) => day.date), el.scrollLeft, viewWidth.value, W.value));
}
let resize: ResizeObserver | null = null;
onMounted(() => {
  if (view.value) viewWidth.value = view.value.clientWidth;
  if (typeof ResizeObserver !== "undefined" && view.value) {
    resize = new ResizeObserver(() => {
      if (view.value) viewWidth.value = view.value.clientWidth;
    });
    resize.observe(view.value);
  }
  void nextTick(place);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  cancelAnimationFrame(frame);
});
watch(() => [W.value, props.range, props.days.length], () => { void nextTick(place); });
watch(() => props.pan, () => {
  const el = view.value;
  if (!el || !layout.value.scrollable) return;
  if (Math.abs(maxScroll.value - el.scrollLeft - props.pan) > 2) place();
});
</script>

<template>
  <div class="pchart" :style="{ '--plot': `${H}px` }">
    <p v-if="empty" class="t-body c2 none">{{ empty }}</p>
    <div class="plotrow">
      <div ref="view" class="view" :class="{ scroll: layout.scrollable }" data-chart-view @scroll.passive="onScroll">
        <svg v-if="W > 0 && !empty" :width="W" :height="H + LABELS" :viewBox="`0 0 ${W} ${H + LABELS}`" class="fig" role="img" :aria-label="`${title} chart`">
          <defs v-if="page === 'weight'">
            <clipPath :id="`wplot-${uid}`"><rect x="0" y="0" :width="W" :height="H" /></clipPath>
          </defs>
          <line v-for="y in gridLines" :key="y" x1="0" :x2="W" :y1="y" :y2="y" stroke="var(--text-primary)" stroke-opacity="0.07" />
          <template v-if="page === 'weight'">
            <!-- Possible range (±2σ) in a faint neutral, then the likely range (±1σ) in the chart colour. -->
            <path v-if="shapes.outer" :d="shapes.outer" :clip-path="`url(#wplot-${uid})`" fill="var(--text-primary)" fill-opacity="0.06" data-band-outer />
            <path v-if="shapes.inner" :d="shapes.inner" :clip-path="`url(#wplot-${uid})`" fill="var(--chart-line)" fill-opacity="0.18" data-band />
            <circle v-for="dot in weightDots" :key="dot.key" :cx="dot.x" :cy="dot.y" :r="dotRadius" fill="var(--chart-line)" fill-opacity="0.4" />
            <path v-if="shapes.dashed" :d="shapes.dashed" fill="none" stroke="var(--chart-line)" stroke-opacity="0.75" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5" data-trend-dashed />
            <path v-if="shapes.solid" :d="shapes.solid" fill="none" stroke="var(--chart-line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" data-trend-solid />
            <template v-if="lastTrend">
              <circle :cx="lastTrend.x" :cy="lastTrend.y" r="4" fill="var(--color-surface)" stroke="var(--chart-line)" stroke-width="2.2" />
              <rect :x="lastTrend.x - 48" :y="Math.max(0, lastTrend.y - 27)" width="42" height="18" rx="9" fill="var(--color-surface-2)" />
              <text :x="lastTrend.x - 27" :y="Math.max(0, lastTrend.y - 27) + 12.5" text-anchor="middle" class="pill" data-trend-label>{{ lastTrend.text }}</text>
            </template>
          </template>
          <template v-else>
            <rect v-for="bar in bars" :key="bar.key" :x="bar.x" :y="bar.y" :width="bw" :height="bar.h" :rx="Math.min(2, bw / 2)" fill="var(--chart-line)" :fill-opacity="bar.off ? 0.45 : 0.95" data-bar />
            <line v-for="step in steps" :key="`${step.x1}-${step.value}`" :x1="step.x1" :x2="step.x2" :y1="step.y" :y2="step.y" stroke="var(--text-primary)" stroke-opacity="0.55" stroke-width="1.4" stroke-dasharray="4 3" />
            <template v-if="stepLabel">
              <rect :x="stepLabel.x - stepLabel.width" :y="stepLabel.y - 10" :width="stepLabel.width" height="13" rx="4" fill="var(--color-surface)" fill-opacity="0.85" />
              <text :x="stepLabel.x - 4" :y="stepLabel.y" text-anchor="end" class="tag" data-target-label>{{ stepLabel.text }}</text>
            </template>
          </template>
          <template v-if="previewDot">
            <line :x1="previewDot.x" :x2="previewDot.x" :y1="previewDot.y + 6" :y2="H" stroke="var(--text-primary)" stroke-opacity="0.25" stroke-dasharray="2 3" />
            <circle :cx="previewDot.x" :cy="previewDot.y" r="5" fill="var(--color-surface)" stroke="var(--text-primary)" stroke-width="2" data-preview />
          </template>
          <circle v-if="marker != null" :cx="marker" :cy="H + 3" r="2.2" fill="var(--text-primary)" data-selected-day />
          <text v-for="label in xLabels" :key="label.key" :x="label.x" :y="H + LABELS - 3" :text-anchor="label.anchor" class="tag">{{ label.text }}</text>
        </svg>
      </div>
      <div class="ylabs" aria-hidden="true">
        <span v-for="label in (empty ? [] : yLabels)" :key="label.key" class="ylab" :style="{ top: `${label.top}px` }">{{ label.text }}</span>
      </div>
      <span v-show="fadeLeft" class="edge left" aria-hidden="true" data-fade-left />
      <span v-show="fadeRight" class="edge right" aria-hidden="true" data-fade-right />
    </div>
  </div>
</template>

<style scoped>
.pchart { position: relative; min-width: 0; }
.none { position: absolute; inset: 0 34px 20px 0; display: flex; align-items: center; justify-content: center; margin: 0; text-align: center; }
.plotrow { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 34px; height: calc(var(--plot) + 20px); min-width: 0; }
.view { min-width: 0; overflow: hidden; }
/* A sideways drag pans the chart and stops at its ends instead of turning the page. */
.view.scroll { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.view.scroll::-webkit-scrollbar { display: none; }
.fig { display: block; }
.tag { font-size: 10.5px; fill: var(--text-tertiary); font-family: inherit; }
.pill { font-size: 10.5px; font-weight: 700; fill: var(--text-primary); font-family: inherit; font-variant-numeric: tabular-nums; }
.ylabs { position: relative; }
.ylab { position: absolute; right: 0; transform: translateY(-50%); font-size: min(0.6471rem, 13px); line-height: 1; color: var(--text-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.edge { position: absolute; top: 0; bottom: 0; width: 22px; pointer-events: none; }
.edge.left { left: 0; background: linear-gradient(to right, var(--color-surface), transparent); }
.edge.right { right: 34px; background: linear-gradient(to left, var(--color-surface), transparent); }
</style>
