<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { getProgress } from "../api";
import { addDays, weekStart } from "../lib/dates";
import { dayShade } from "../lib/dayShade";
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
let lastY = 0;
const openKey = "gymbro-home-week-open";
const expanded = ref(false);
const reduceMotion = ref(false);
const intake = ref<Record<string, { logged: boolean; kcal: number | null; targetKcal: number | null }>>({});

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
  lastY = event.clientY;
  if (expanded.value) {
    if (Math.abs(dy) > 8) mode = "v";
    return;
  }
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
  const dy = lastY - originY;
  const horizontal = mode === "h";
  const vertical = mode === "v";
  if (horizontal && Math.abs(dx) > 8) {
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
  }
  mode = "none";
  if (vertical && dy > 40 && !expanded.value) setExpanded(true);
  if (vertical && dy < -40 && expanded.value) setExpanded(false);
  if (!horizontal || expanded.value) return;
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

const calendar = computed(() => [3, 2, 1, 0].map((ago) => {
  const start = addDays(shown.value, -7 * ago);
  return weekDays(start, props.selected, props.today, props.setupDate, props.loggedDates).map((day) => {
    const fact = intake.value[day.date];
    const logged = fact ? fact.logged : day.logged;
    return { ...day, ...dayShade(day.date, props.today, logged, fact?.kcal ?? null, fact?.targetKcal ?? null) };
  });
}));

function readOpen(): boolean {
  if (!props.swipe) return false;
  try { return localStorage.getItem(openKey) === "1"; } catch { return false; }
}
function setExpanded(next: boolean) {
  expanded.value = next;
  try { localStorage.setItem(openKey, next ? "1" : "0"); } catch { /* the pick still applies this visit */ }
  if (next) void loadShades();
}
async function loadShades() {
  try {
    const data = await getProgress("90d");
    const next: typeof intake.value = {};
    for (const day of data.days) next[day.date] = { logged: day.logged, kcal: day.kcal, targetKcal: day.targetKcal };
    intake.value = next;
  } catch {
    // Tiles still show logged or empty from the week the strip already knows.
  }
}
function pickTile(date: string, disabled: boolean) {
  if (disabled) return;
  emit("select", date);
  showWeekOf(date);
  setExpanded(false);
}

onMounted(() => {
  shown.value = weekStart(props.selected || props.anchor || props.today);
  reduceMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  expanded.value = readOpen();
  if (expanded.value) void loadShades();
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
  <div v-else class="homeweek" :class="{ still: reduceMotion }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
  <div v-show="!expanded" ref="pager" class="pager">
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
  <div class="calwrap" :class="{ open: expanded }">
    <div class="cal" role="group" aria-label="Last 4 weeks" :inert="!expanded" :aria-hidden="!expanded">
      <div class="calrow letters">
        <span v-for="(letter, index) in ['M','T','W','T','F','S','S']" :key="index" class="t-cap c3">{{ letter }}</span>
      </div>
      <div v-for="(week, index) in calendar" :key="index" class="calrow">
        <button
          v-for="day in week"
          :key="day.date"
          type="button"
          class="tile"
          :class="[day.date === today ? 'today' : day.disabled ? 'future' : `s-${day.shade}`, { over: day.over && day.date !== today }]"
          :disabled="day.disabled"
          :aria-pressed="day.date === selected"
          :aria-label="day.label"
          @click="pickTile(day.date, day.disabled)"
        >
          <span class="t-label">{{ day.number }}</span>
          <Icon v-if="day.date < today && day.shade === 'on' && !day.over" name="check" :size="10" :sw="3.4" class="mark" />
          <span v-else-if="day.date < today && day.over" class="corner" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
  <button type="button" class="grab" :aria-expanded="expanded" :aria-label="expanded ? 'Hide the calendar' : 'Show the last 4 weeks'" @click="setExpanded(!expanded)">
    <span class="grip" aria-hidden="true" />
    <Icon name="down" :size="16" class="chev" :class="{ up: expanded }" />
  </button>
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
.homeweek { display: flex; flex-direction: column; min-width: 0; }
.calwrap { max-height: 0; overflow: hidden; transition: max-height .28s ease; }
.calwrap.open { max-height: 520px; }
.cal { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); padding: var(--space-gap); background: var(--color-surface); border-radius: var(--radius-card); }
.calrow { display: flex; gap: 4px; }
.calrow > * { flex: 1 1 0; min-width: 0; text-align: center; }
.letters { min-height: 16px; }
.tile {
  position: relative; min-height: 44px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center; color: var(--text-primary);
}
.tile.future { color: var(--text-tertiary); }
.tile.today { box-shadow: inset 0 0 0 2px var(--color-action); }
.tile.s-on { background: var(--shade-on-target); color: var(--color-on-action); }
.tile.s-close { background: var(--shade-close); color: var(--color-on-action); }
.tile.s-off { background: var(--shade-off); }
.tile.s-far { background: var(--shade-far); }
.tile.s-none { outline: 1px dashed var(--color-border); outline-offset: -1px; }
.tile.s-notarget { color: var(--text-secondary); }
.tile.over { background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.28) 0 2px, transparent 2px 6px); }
.tile .mark { position: absolute; top: 4px; right: 4px; }
.corner { position: absolute; top: 4px; right: 4px; width: 0; height: 0; border-left: 7px solid transparent; border-top: 7px solid var(--text-secondary); }
.grab {
  min-width: 44px; min-height: 44px; align-self: center;
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: var(--text-secondary);
}
.grip { width: 36px; height: 4px; border-radius: 2px; background: var(--color-border-strong); }
.chev { transition: transform .28s ease; }
.chev.up { transform: rotate(180deg); }
.still .calwrap, .still .chev, .still .track { transition: none; }
</style>
