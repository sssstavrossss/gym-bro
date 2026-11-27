<script setup lang="ts">
// Under the Home Progress chart: your history in miniature, with the days in view boxed. Drag the box (or tap the
// strip) to move the window a day at a time. When the window already covers the whole strip, nothing moves.
import { computed } from "vue";
import { boxOf, maxOffset, offsetAtStripDay, STRIP_HEIGHT, type StripShape } from "../lib/progressWindow";

const props = defineProps<{
  shape: StripShape;
  /** Days the strip covers, ending today. */
  span: number;
  /** Days in the window. */
  length: number;
  /** Days the window ends before today. */
  offset: number;
  /** The dates in view, for the slider's spoken value. */
  label: string;
}>();
const emit = defineEmits<{ move: [offset: number] }>();

const whole = computed(() => props.span <= props.length);
const most = computed(() => maxOffset(props.span, props.length));
const box = computed(() => boxOf(props.span, props.length, props.offset));
const H = STRIP_HEIGHT;

/** Grabbing the box keeps it where the finger took it; a touch elsewhere on the strip jumps there. */
let drag: { id: number; el: HTMLElement; grab: number } | null = null;
function dayAt(event: PointerEvent, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return { day: ((event.clientX - rect.left) / rect.width) * props.span, perPx: props.span / rect.width };
}
function down(event: PointerEvent) {
  if (whole.value) return;
  const el = event.currentTarget as HTMLElement;
  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    // Not a live pointer (a synthetic event): the drag still follows moves over the strip.
  }
  const { day, perPx } = dayAt(event, el);
  const centre = props.span - props.offset - props.length / 2;
  // The box, or a finger's width around a narrow one.
  const onBox = Math.abs(day - centre) / perPx <= Math.max(22, props.length / perPx / 2);
  drag = { id: event.pointerId, el, grab: onBox ? centre - day : 0 };
  if (!onBox) emit("move", offsetAtStripDay(day, props.span, props.length));
}
function move(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return;
  emit("move", offsetAtStripDay(dayAt(event, drag.el).day + drag.grab, props.span, props.length));
}
function up(event: PointerEvent) {
  if (drag?.id === event.pointerId) drag = null;
}
function key(event: KeyboardEvent) {
  if (whole.value) return;
  const by: Record<string, number> = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1, PageUp: props.length, PageDown: -props.length };
  if (event.key === "Home") emit("move", most.value);
  else if (event.key === "End") emit("move", 0);
  else if (by[event.key] != null) emit("move", props.offset + by[event.key]);
  else return;
  // The pages turn on the same keys; on the strip they move the days instead.
  event.preventDefault();
  event.stopPropagation();
}
</script>

<template>
  <!-- touchstart stops here so the pages don't swipe while the box is dragged. -->
  <div
    class="ostrip" :class="{ whole }" role="slider" :tabindex="whole ? -1 : 0"
    :aria-label="`Days shown`" :aria-valuetext="label" :aria-valuemin="0" :aria-valuemax="most" :aria-valuenow="most - offset" :aria-disabled="whole || undefined"
    data-progress-strip
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @touchstart.stop @keydown="key"
  >
    <span class="otrack" aria-hidden="true">
      <svg class="ofig" :viewBox="`0 0 ${span} ${H}`" preserveAspectRatio="none">
        <line v-for="m in shape.months" :key="m" :x1="m" :x2="m" y1="0" :y2="H" stroke="var(--text-primary)" stroke-opacity="0.08" vector-effect="non-scaling-stroke" />
        <path v-if="shape.band" :d="shape.band" fill="var(--chart-line)" fill-opacity="0.18" />
        <path v-if="shape.line" :d="shape.line" fill="none" stroke="var(--chart-line)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        <rect v-for="b in shape.bars" :key="b.x" :x="b.x" :y="H - b.h" :width="b.w" :height="b.h" fill="var(--chart-line)" :fill-opacity="b.off ? 0.4 : 0.9" />
        <path v-if="shape.target" :d="shape.target" fill="none" stroke="var(--text-primary)" stroke-opacity="0.35" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="shade l" :style="{ width: `${box.left}%` }" />
      <span class="shade r" :style="{ left: `${box.left + box.width}%` }" />
      <span class="obox" data-strip-box :style="{ left: `clamp(7px, ${box.left + box.width / 2}%, 100% - 7px)`, width: `max(14px, ${box.width}%)` }"><span class="ogrip" /></span>
    </span>
  </div>
</template>

<style scoped>
/*
 * A 44px hit around a 36px strip, lined up with the plot (not the 34px y labels). It pulls up into the page's gap
 * under the chart. It takes every drag on it, so a slanted one can't turn into a page scroll halfway, and sits above
 * the pages' 24px previous/next tap zones, which would otherwise take its ends.
 */
.ostrip { position: relative; z-index: 3; display: flex; align-items: center; height: var(--control-hit); margin: calc(var(--space-m) * -1) 34px calc(var(--space-xs) * -1) 0; touch-action: none; cursor: grab; -webkit-user-select: none; user-select: none; border-radius: var(--radius-xs); }
.ostrip:active { cursor: grabbing; }
/* The window covers the whole strip (All, or a range longer than your history): nothing to drag. */
.ostrip.whole { cursor: default; }
.ostrip.whole .ogrip { display: none; }
.otrack { position: relative; flex: 1; height: 36px; border-radius: var(--radius-xs); background: color-mix(in srgb, var(--color-surface-2) 55%, transparent); overflow: hidden; }
.ofig { position: absolute; inset: 0; width: 100%; height: 100%; }
/* Outside the window is dimmed, so the days in view stand out. */
.shade { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--color-surface) 62%, transparent); pointer-events: none; }
.shade.l { left: 0; }
.shade.r { right: 0; }
.obox { position: absolute; top: 0; bottom: 0; display: grid; place-items: center; translate: -50% 0; border: 1.5px solid var(--text-primary); border-radius: var(--radius-xs); background: color-mix(in srgb, var(--chart-line) 10%, transparent); pointer-events: none; }
.ogrip { width: 2px; height: 10px; border-radius: 1px; background: var(--text-primary); opacity: .7; }
</style>
