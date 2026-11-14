<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { addDays, weekStart } from "../lib/dates";
import { weekDays, weekPageSelection } from "../lib/dayLog";

const props = withDefaults(defineProps<{
  anchor: string;
  selected: string;
  today: string;
  setupDate: string;
  loggedDates: string[];
  swipe?: boolean;
}>(), { swipe: false });
const emit = defineEmits<{ select: [string] }>();

const shown = ref(weekStart(props.selected || props.anchor || props.today));
const pager = ref<HTMLElement | null>(null);
const dragX = ref(0);
const animating = ref(false);
const dragging = ref(false);
let pendingStart: string | null = null;
let originX = 0;
let originY = 0;
let mode: "none" | "h" | "v" = "none";
let suppressClick = false;
let fallback = 0;

const todayStart = computed(() => weekStart(props.today || props.anchor));
const starts = computed(() => {
  const current = shown.value || todayStart.value;
  const list = [addDays(current, -7), current];
  const next = addDays(current, 7);
  if (next <= todayStart.value) list.push(next);
  return list;
});
const pages = computed(() => starts.value.map((start) => ({
  start,
  days: weekDays(start, props.selected, props.today, props.setupDate, props.loggedDates),
})));

function showWeekOf(date: string) {
  const start = weekStart(date);
  const limit = todayStart.value;
  const next = start > limit ? limit : start;
  if (next === shown.value) return;
  pendingStart = null;
  animating.value = false;
  dragX.value = 0;
  shown.value = next;
}
watch(() => props.selected, (date) => {
  if (!props.swipe || dragging.value) return;
  showWeekOf(date);
});

function trackStyle() {
  const shift = dragX.value === 0 ? "-100%" : `calc(-100% + ${dragX.value}px)`;
  return {
    transform: `translate3d(${shift}, 0, 0)`,
    transition: animating.value ? "transform .28s ease" : "none",
  };
}

function down(event: PointerEvent) {
  if (!props.swipe || event.button !== 0 || animating.value) return;
  originX = event.clientX;
  originY = event.clientY;
  mode = "none";
  dragging.value = true;
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}
function move(event: PointerEvent) {
  if (!dragging.value) return;
  const dx = event.clientX - originX;
  const dy = event.clientY - originY;
  if (mode === "none") {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) >= Math.abs(dx)) {
      mode = "v";
      return;
    }
    mode = "h";
    pager.value?.setPointerCapture(event.pointerId);
  }
  if (mode !== "h") return;
  const width = pager.value?.clientWidth || 1;
  let next = dx;
  if (next > width) next = width;
  if (next < -width) next = -width;
  if (next < 0 && starts.value.length < 3) next /= 4;
  dragX.value = next;
}
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  const dx = dragX.value;
  const horizontal = mode === "h";
  if (horizontal && Math.abs(dx) > 8) {
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
  }
  mode = "none";
  if (!horizontal) return;
  const width = pager.value?.clientWidth || 1;
  const threshold = Math.min(72, width * 0.22);
  if (dx > threshold) settle(-1, width);
  else if (dx < -threshold && starts.value.length > 2) settle(1, width);
  else {
    animating.value = true;
    dragX.value = 0;
  }
}
function settle(direction: -1 | 1, width: number) {
  pendingStart = addDays(shown.value, direction * 7);
  if (weekStart(pendingStart) > todayStart.value) {
    pendingStart = null;
    animating.value = true;
    dragX.value = 0;
    return;
  }
  animating.value = true;
  dragX.value = direction === -1 ? width : -width;
  window.clearTimeout(fallback);
  fallback = window.setTimeout(commit, 320);
}
function commit() {
  if (!pendingStart) return;
  const start = pendingStart;
  pendingStart = null;
  animating.value = false;
  dragX.value = 0;
  shown.value = start;
  const picked = weekPageSelection(props.selected, start, props.today, props.setupDate);
  if (picked && picked !== props.selected) emit("select", picked);
}
function onTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== "transform" || !pendingStart) return;
  window.clearTimeout(fallback);
  commit();
}
function choose(event: MouseEvent, date: string, disabled: boolean) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!disabled) emit("select", date);
}
function pageBy(direction: -1 | 1) {
  if (animating.value || dragging.value) return;
  const width = pager.value?.clientWidth || 1;
  if (direction === 1 && starts.value.length < 3) return;
  settle(direction, width);
}

onMounted(() => {
  shown.value = weekStart(props.selected || props.anchor || props.today);
});
onBeforeUnmount(() => {
  window.clearTimeout(fallback);
  window.removeEventListener("pointerup", up);
  window.removeEventListener("pointercancel", up);
});
</script>

<template>
  <div v-if="!swipe" class="row week" role="group" aria-label="This week">
    <button
      v-for="day in weekDays(anchor, selected, today, setupDate, loggedDates)"
      :key="day.date"
      type="button"
      class="day"
      :disabled="day.disabled"
      :aria-pressed="day.date === selected"
      :aria-label="day.label"
      @click="emit('select', day.date)"
    >
      <span class="t-cap letter c3" aria-hidden="true">{{ day.letter }}</span>
      <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">{{ day.number }}</span>
      <span class="dotrow" aria-hidden="true"><span class="dot" :class="{ on: day.logged }" /></span>
    </button>
  </div>
  <div
    v-else
    ref="pager"
    class="pager"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <div class="track" :style="trackStyle()" @transitionend="onTransitionEnd">
      <div
        v-for="page in pages"
        :key="page.start"
        class="row week"
        :role="page.start === shown ? 'group' : undefined"
        :aria-label="page.start === shown ? 'This week' : undefined"
        :aria-hidden="page.start === shown ? undefined : true"
      >
        <button
          v-for="day in page.days"
          :key="day.date"
          type="button"
          class="day"
          :disabled="day.disabled"
          :aria-pressed="day.date === selected"
          :aria-label="day.label"
          :tabindex="page.start === shown ? undefined : -1"
          @click="choose($event, day.date, day.disabled)"
        >
          <span class="t-cap letter c3" aria-hidden="true">{{ day.letter }}</span>
          <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">{{ day.number }}</span>
          <span class="dotrow" aria-hidden="true"><span class="dot" :class="{ on: day.logged }" /></span>
        </button>
      </div>
    </div>
    <button type="button" class="sr-only" @click="pageBy(-1)">Previous week</button>
    <button type="button" class="sr-only" :disabled="starts.length < 3" @click="pageBy(1)">Next week</button>
  </div>
</template>

<style scoped>
.pager, .pager .week, .pager .day { touch-action: pan-y; }
.pager { overflow: hidden; width: 100%; min-width: 0; }
.track { display: flex; width: 100%; }
.pager .week { flex: 0 0 100%; min-width: 100%; }
.week {
  justify-content: space-between; align-items: center;
  /* Bottom is the 12px token under the reserved dot row. Top is 1px less so the letter cap, which paints 1px below the padding edge, is also 12px from the band. */
  padding: calc(var(--space-gap) - 1px) calc(var(--space-gap) / 2) var(--space-gap);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}
.day {
  width: 44px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: var(--text-primary);
}
.day:disabled { cursor: default; }
.letter { display: block; font-size: min(0.6471rem, 15px); line-height: 1; color: var(--text-tertiary); }
.circle { width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: min(0.8824rem, 20px); line-height: 1; color: var(--text-primary); flex: none; }
.circle.on { background: var(--color-action); color: var(--color-on-action); }
.circle.off { color: var(--text-tertiary); opacity: 0.72; }
.dotrow { height: 4px; display: flex; align-items: center; justify-content: center; flex: none; }
.dot { width: 4px; height: 4px; border-radius: 2px; }
.dot.on { background: var(--text-tertiary); }
</style>
