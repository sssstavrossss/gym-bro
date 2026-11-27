<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import TrainBadge from "./TrainBadge.vue";
import { getProgress } from "../api";
import { addDays, weekStart } from "../lib/dates";
import { dayShade } from "../lib/dayShade";
import { weekDays, weekPageSelection } from "../lib/dayLog";
import { onLogChange } from "../state/log";
import { loadTrainingDays, trainingDays } from "../state/trainingDays";
import { weightUnit } from "../state/units";
import { cardTitle, fourWeekTotals, kcalLine, KIND_ICONS, KIND_ORDER, trainingSaid, type TrainState } from "../lib/trainingDays";
import { weightText } from "../lib/units";
import { swipeAxis, swipeSpeed, swipeTurn, type SwipeSample } from "../lib/weekSwipe";

const props = withDefaults(defineProps<{
  anchor: string;
  selected: string;
  today: string;
  setupDate: string;
  loggedDates: string[];
  swipe?: boolean;
}>(), { swipe: false });
const emit = defineEmits<{ select: [string]; range: [string, string] }>();

const shown = ref(weekStart(props.selected || props.anchor || props.today));
const pager = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
let settling = false;
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
/** Recent pointer positions, so a quick flick turns the week without a long drag. */
let samples: SwipeSample[] = [];
const openKey = "gymbro-home-week-open";
const expanded = ref(false);
const reduceMotion = ref(false);
const intake = ref<Record<string, { logged: boolean; kcal: number | null; targetKcal: number | null }>>({});
/** Weigh-ins by date (kg), from the same load as the shades. */
const weighIns = ref<Record<string, number>>({});
/** Each day's workouts (lib/trainingDays.ts): the strip and the calendar show the first as a badge. */
const training = computed(() => trainingDays(props.today));
/** A strip day's name with its workouts, for screen readers. */
const said = (day: { date: string; label: string }) => `${day.label}${trainingSaid(training.value[day.date])}`;
/** The calendar tile whose day card is open, or null. */
const picked = ref<string | null>(null);

const todayStart = computed(() => weekStart(props.today || props.anchor));
const starts = computed(() => {
  const current = shown.value || todayStart.value;
  return [addDays(current, -7), current, addDays(current, 7)];
});
/** The span the header names: the shown week, or the four weeks when the calendar is open. */
const range = computed<[string, string]>(() => {
  const current = shown.value || todayStart.value;
  return [addDays(current, expanded.value ? -21 : 0), addDays(current, 6)];
});
watch(range, (next) => emit("range", next[0], next[1]), { immediate: true });
const pages = computed(() => starts.value.map((start) => ({
  start,
  days: weekDays(start, props.selected, props.today, props.setupDate, props.loggedDates),
})));

function showWeekOf(date: string) {
  const next = weekStart(date);
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
  if (!props.swipe || event.button !== 0 || pendingStart) return;
  originX = event.clientX;
  originY = event.clientY;
  lastY = event.clientY;
  samples = [{ t: event.timeStamp, x: event.clientX }];
  mode = "none";
  // Catch a strip that is still springing back instead of waiting for it.
  window.clearTimeout(fallback);
  animating.value = false;
  dragging.value = true;
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}
function move(event: PointerEvent) {
  if (!dragging.value) return;
  let dx = event.clientX - originX;
  const dy = event.clientY - originY;
  lastY = event.clientY;
  samples.push({ t: event.timeStamp, x: event.clientX });
  while (samples.length > 2 && event.timeStamp - samples[0].t > 100) samples.shift();
  if (expanded.value) {
    if (Math.abs(dy) > 8) mode = "v";
    return;
  }
  if (mode === "none") {
    mode = swipeAxis(dx, dy);
    if (mode !== "h") return;
    pager.value?.setPointerCapture(event.pointerId);
  } else if (mode === "v") {
    // The page did not take the gesture (no pointercancel) and it has turned sideways: page after all.
    if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy)) return;
    mode = "h";
    originX = event.clientX;
    dx = 0;
    pager.value?.setPointerCapture(event.pointerId);
  }
  if (mode !== "h") return;
  const width = pager.value?.clientWidth || 1;
  dragX.value = Math.max(-width, Math.min(width, dx));
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
  const turn = swipeTurn(dx, swipeSpeed(samples), width);
  if (turn) settle(turn, width);
  else snapBack();
}
function snapBack() {
  window.clearTimeout(fallback);
  if (dragX.value === 0) {
    animating.value = false;
    return;
  }
  animating.value = true;
  dragX.value = 0;
  fallback = window.setTimeout(() => { animating.value = false; }, 320);
}
function settle(direction: -1 | 1, width: number) {
  pendingStart = addDays(shown.value, direction * 7);
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
  if (event.propertyName !== "transform") return;
  window.clearTimeout(fallback);
  if (pendingStart) commit();
  else animating.value = false;
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
async function pageBy(direction: -1 | 1) {
  if (dragging.value) return;
  if (pendingStart) {
    // A quick second tap: land the week that is sliding in now, then slide on from there.
    window.clearTimeout(fallback);
    commit();
    await nextTick();
    void pager.value?.offsetWidth;
  }
  if (expanded.value || reduceMotion.value) {
    // The pager is hidden (or still), so there is no slide to wait for.
    shown.value = addDays(shown.value, direction * 7);
    if (!expanded.value) {
      const picked = weekPageSelection(props.selected, shown.value, props.today, props.setupDate);
      if (picked && picked !== props.selected) emit("select", picked);
    }
    return;
  }
  settle(direction, pager.value?.clientWidth || 1);
}
defineExpose({ pageBy });

const calendar = computed(() => [3, 2, 1, 0].map((ago) => {
  const start = addDays(shown.value, -7 * ago);
  return weekDays(start, props.selected, props.today, props.setupDate, props.loggedDates).map((day) => {
    const fact = intake.value[day.date];
    const logged = fact ? fact.logged : day.logged;
    const workouts = training.value[day.date] ?? [];
    const kg = weighIns.value[day.date] ?? null;
    const label = `${day.label}${trainingSaid(workouts)}${kg != null ? ", weighed in" : ""}`;
    return { ...day, label, logged, kcal: fact?.kcal ?? null, targetKcal: fact?.targetKcal ?? null, workouts, kg, ...dayShade(day.date, props.today, logged, fact?.kcal ?? null, fact?.targetKcal ?? null) };
  });
}));
const calendarDays = computed(() => calendar.value.flat());
/** The four weeks' totals under the calendar, up to today. */
const totals = computed(() => {
  const days = calendarDays.value;
  const shades = Object.fromEntries(days.map((day) => [day.date, day.shade]));
  return fourWeekTotals(days.map((day) => day.date), props.today, props.setupDate, shades, training.value, new Set(Object.keys(weighIns.value)));
});
/** The key lists only what the four weeks show. */
const key = computed(() => {
  const past = calendarDays.value.filter((day) => day.date < props.today && !day.disabled);
  const workouts = calendarDays.value.flatMap((day) => day.workouts);
  return {
    over: past.some((day) => day.over),
    none: past.some((day) => day.shade === "none"),
    notarget: past.some((day) => day.shade === "notarget"),
    states: (["done", "planned", "skipped"] as TrainState[]).filter((state) => workouts.some((item) => item.state === state)),
    kinds: KIND_ORDER.filter((kind) => workouts.some((item) => item.kind === kind)),
    weighed: calendarDays.value.some((day) => day.kg != null),
  };
});
/** The tapped day's card: its calories, workouts and weigh-in. */
const card = computed(() => {
  const day = picked.value ? calendarDays.value.find((item) => item.date === picked.value) : null;
  if (!day) return null;
  return {
    date: day.date,
    title: cardTitle(day.date, props.today),
    kcal: kcalLine(day.date, props.today, day.logged, day.kcal, day.targetKcal),
    workouts: day.workouts,
    rest: day.date > props.today ? "No workout planned" : "Rest day",
    weight: day.kg != null ? `${weightText(day.kg, weightUnit())} ${weightUnit()}` : "No weigh-in",
  };
});

function readOpen(): boolean {
  if (!props.swipe) return false;
  try { return localStorage.getItem(openKey) === "1"; } catch { return false; }
}
function lockStage() {
  const el = stage.value;
  if (!el || reduceMotion.value) return;
  el.style.height = `${el.getBoundingClientRect().height}px`;
}
async function glideStage() {
  const el = stage.value;
  if (!el || reduceMotion.value) {
    if (el) el.style.height = "auto";
    return;
  }
  await nextTick();
  const face = el.querySelector<HTMLElement>(expanded.value ? ".cal.face" : ".pager.face");
  const height = face?.offsetHeight ?? 0;
  settling = true;
  requestAnimationFrame(() => {
    el.style.height = `${height}px`;
  });
}
function onStageEnd(event: TransitionEvent) {
  if (!settling || event.propertyName !== "height" || event.target !== stage.value) return;
  settling = false;
  if (stage.value) stage.value.style.height = "auto";
}
function setExpanded(next: boolean) {
  if (next === expanded.value) return;
  lockStage();
  expanded.value = next;
  picked.value = null;
  try { localStorage.setItem(openKey, next ? "1" : "0"); } catch { /* the pick still applies this visit */ }
  if (next) void loadShades();
  void glideStage();
}
// The calendar's colours come from the server's totals, so they follow the log.
onLogChange(() => { if (expanded.value) void loadShades(); });
async function loadShades() {
  try {
    const data = await getProgress("90d");
    const next: typeof intake.value = {};
    for (const day of data.days) next[day.date] = { logged: day.logged, kcal: day.kcal, targetKcal: day.targetKcal };
    intake.value = next;
    weighIns.value = Object.fromEntries(data.weight.weighIns.map((item) => [item.date, item.kg]));
  } catch {
    // Tiles still show logged or empty from the week the strip already knows.
  }
}
/** A tap on a tile opens its day card; a second tap on the same tile (or Open day) goes to the day. */
function pickTile(date: string, disabled: boolean) {
  if (disabled) return;
  if (picked.value === date) openDay(date);
  else picked.value = date;
}
function openDay(date: string) {
  emit("select", date);
  showWeekOf(date);
  setExpanded(false);
}

onMounted(() => {
  shown.value = weekStart(props.selected || props.anchor || props.today);
  reduceMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  expanded.value = readOpen();
  if (expanded.value) void loadShades();
  loadTrainingDays();
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
      :aria-label="said(day)"
      @click="emit('select', day.date)"
    >
      <span class="t-cap letter c3" aria-hidden="true">{{ day.letter }}</span>
      <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">
        {{ day.number }}
        <TrainBadge v-if="training[day.date]?.length" class="on-circle" :kind="training[day.date][0].kind" :state="training[day.date][0].state" />
      </span>
      <span class="dotrow" aria-hidden="true"><span class="dot" :class="{ on: day.logged }" /></span>
    </button>
  </div>
  <div v-else class="homeweek" :class="{ still: reduceMotion }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
  <div ref="stage" class="stage" @transitionend="onStageEnd">
  <div ref="pager" class="pager face" :class="{ on: !expanded }" :inert="expanded" :aria-hidden="expanded">
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
          :aria-label="said(day)"
          :tabindex="page.start === shown ? undefined : -1"
          @click="choose($event, day.date, day.disabled)"
        >
          <span class="t-cap letter c3" aria-hidden="true">{{ day.letter }}</span>
          <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">
            {{ day.number }}
            <TrainBadge v-if="training[day.date]?.length" class="on-circle" :kind="training[day.date][0].kind" :state="training[day.date][0].state" />
          </span>
          <span class="dotrow" aria-hidden="true"><span class="dot" :class="{ on: day.logged }" /></span>
        </button>
      </div>
    </div>
  </div>
    <div class="cal face" :class="{ on: expanded }" role="group" aria-label="Last 4 weeks" :inert="!expanded" :aria-hidden="!expanded">
      <div class="calrow letters">
        <span v-for="(letter, index) in ['M','T','W','T','F','S','S']" :key="index" class="t-cap c3">{{ letter }}</span>
      </div>
      <div v-for="(week, index) in calendar" :key="index" class="calrow">
        <button
          v-for="day in week"
          :key="day.date"
          type="button"
          class="tile"
          :class="[day.date === today ? 'today' : day.disabled ? 'future' : `s-${day.shade}`, { picked: day.date === picked }]"
          :disabled="day.disabled"
          :aria-pressed="day.date === picked"
          :aria-label="day.label"
          :data-date="day.date"
          @click="pickTile(day.date, day.disabled)"
        >
          <span class="t-label">{{ day.number }}</span>
          <Icon v-if="day.date < today && day.shade === 'on' && !day.over" name="check" :size="10" :sw="3.4" class="mark" />
          <span v-else-if="day.date < today && day.over" class="corner" aria-hidden="true" />
          <span v-if="day.workouts.length || day.kg != null" class="feet" aria-hidden="true">
            <TrainBadge v-if="day.workouts.length" :kind="day.workouts[0].kind" :state="day.workouts[0].state" />
            <span v-if="day.kg != null" class="weigh" data-weighed><Icon name="scale" :size="10" :sw="2.4" /></span>
          </span>
        </button>
      </div>
      <!-- The key and totals, or a tapped day's card in their place. Both keep their room, so opening or closing the
           card never moves the page. -->
      <div class="under">
        <div class="key" :class="{ gone: card }" :inert="!!card" :aria-hidden="!!card">
          <div class="legend t-capn c2">
            <span class="scale"><i class="sw on" /><i class="sw close" /><i class="sw off" /><i class="sw far" /> on target → far off</span>
            <span v-if="key.over"><i class="tri" /> over</span>
            <span v-if="key.none"><i class="sw none" /> not logged</span>
            <span v-if="key.notarget"><i class="sw notarget" /> no target</span>
          </div>
          <div v-if="key.states.length || key.weighed" class="legend t-capn c2">
            <span v-for="state in key.states" :key="state"><i class="st" :class="state" /> {{ state }}</span>
            <span v-if="key.weighed"><span class="weigh"><Icon name="scale" :size="10" :sw="2.4" /></span> weighed in</span>
          </div>
          <div v-if="key.kinds.length" class="legend t-capn c2">
            <span v-for="kind in key.kinds" :key="kind"><Icon :name="KIND_ICONS[kind]" :size="12" :sw="2.4" /> {{ kind }}</span>
          </div>
          <div class="pstats" data-week-totals>
            <div class="cell"><span class="t-cap c2">On target</span><span class="num">{{ totals.onTarget }} {{ totals.onTarget === 1 ? "day" : "days" }}</span><span class="t-capn c2">within ±10%</span></div>
            <div class="cell"><span class="t-cap c2">Workouts</span><span class="num">{{ totals.done }}</span><span class="t-capn c2">{{ totals.skipped ? `${totals.skipped} skipped` : "none skipped" }}</span></div>
            <div class="cell"><span class="t-cap c2">Weigh-ins</span><span class="num">{{ totals.weighIns }}</span><span class="t-capn c2">of {{ totals.days }} {{ totals.days === 1 ? "day" : "days" }}</span></div>
          </div>
        </div>
        <div v-if="card" class="dcard" role="group" :aria-label="card.title" data-day-card>
          <div class="dhead">
            <span class="t-bodys dtitle">{{ card.title }}</span>
            <button type="button" class="btn sm secondary t-label" data-day-open @click="openDay(card.date)">Open day</button>
            <button type="button" class="xbtn" aria-label="Close the day" data-day-close @click="picked = null"><Icon name="x" :size="16" /></button>
          </div>
          <div class="drow"><span class="dic" aria-hidden="true"><Icon name="food" :size="14" /></span><span class="t-body" data-day-kcal>{{ card.kcal }}</span></div>
          <div v-for="(item, index) in card.workouts" :key="index" class="drow" data-day-workout>
            <TrainBadge large :kind="item.kind" :state="item.state" />
            <span class="t-body">{{ item.name }} <span class="c2">· {{ item.line }}</span></span>
          </div>
          <div v-if="!card.workouts.length" class="drow"><span class="dic" aria-hidden="true"><Icon name="dumbbell" :size="14" /></span><span class="t-body c2">{{ card.rest }}</span></div>
          <div class="drow"><span class="dic" aria-hidden="true"><Icon name="scale" :size="14" /></span><span class="t-body" :class="{ c2: card.weight === 'No weigh-in' }" data-day-weight>{{ card.weight }}</span></div>
        </div>
      </div>
    </div>
  </div>
  <button type="button" class="grab" :aria-expanded="expanded" :aria-label="expanded ? 'Hide the calendar' : 'Show the last 4 weeks'" @click="setExpanded(!expanded)">
    <span class="grab-bar" aria-hidden="true" />
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
  padding: calc(var(--space-m) - 1px) var(--space-s) var(--space-m);
  background: var(--color-surface);
  border-radius: var(--radius-l);
  box-shadow: var(--d-card);
}
.day {
  width: 44px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; gap: var(--space-xs);
  color: var(--text-primary);
}
.day:disabled { cursor: default; }
.letter { display: block; font-size: min(0.6471rem, 15px); line-height: 1; color: var(--text-tertiary); }
.circle { position: relative; width: 36px; height: 36px; border-radius: var(--radius-pill); display: flex; align-items: center; justify-content: center; font-size: min(0.8824rem, 20px); line-height: 1; color: var(--text-primary); flex: none; }
.circle.on { background: var(--color-action); color: var(--color-on-action); box-shadow: var(--d-action); }
.circle.off { color: var(--text-tertiary); opacity: 0.72; }
/* A workout's badge sits on the date's top-right, ringed in the strip's colour so it reads as its own disc. */
.circle > .tb.on-circle { position: absolute; top: calc(-1 * var(--space-xs)); right: calc(-1 * var(--space-xs)); box-shadow: 0 0 0 2px var(--color-surface); }
.circle > .tb.on-circle.planned { box-shadow: 0 0 0 2px var(--color-surface), inset 0 0 0 1px var(--text-tertiary); }
/* On the accent (the picked date, an on-target tile) a done badge turns over so it still shows. */
.circle.on > .tb.done, .tile.s-on .tb.done { background: var(--color-on-action); color: var(--color-action); }
.dotrow { height: 4px; display: flex; align-items: center; justify-content: center; flex: none; }
.dot { width: 4px; height: 4px; border-radius: 2px; }
.dot.on { background: var(--text-tertiary); }
.homeweek { display: flex; flex-direction: column; min-width: 0; }
.stage { position: relative; overflow: hidden; transition: height 340ms cubic-bezier(0.22, 1.05, 0.36, 1); }
.face {
  width: 100%; pointer-events: none;
  position: absolute; left: 0; right: 0; top: 0;
  transition: opacity 220ms ease;
}
.pager.face { opacity: 0; }
.cal.face { opacity: 0; transform: translate3d(0, -6px, 0); transition: opacity 220ms ease, transform 340ms cubic-bezier(0.22, 1.05, 0.36, 1); }
.face.on { opacity: 1; transform: none; pointer-events: auto; position: relative; }
.cal { display: flex; flex-direction: column; gap: var(--space-s); padding: var(--space-m); background: var(--color-surface); border-radius: var(--radius-l); box-shadow: var(--d-card); }
.calrow { display: flex; gap: var(--space-xs); }
.calrow > * { flex: 1 1 0; min-width: 0; text-align: center; }
.letters { min-height: 16px; }
.tile {
  position: relative; min-height: calc(var(--control-hit) + var(--space-xs)); border-radius: var(--radius-m);
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: var(--space-2xs);
  padding: var(--space-s) 0 var(--space-xs); color: var(--text-primary);
}
.feet { margin-top: auto; display: flex; justify-content: center; gap: 2px; }
.weigh { width: var(--badge); height: var(--badge); border-radius: var(--radius-pill); display: inline-flex; align-items: center; justify-content: center; flex: none; background: var(--color-surface); color: var(--text-secondary); }
/* The tapped tile: a ring outside it in the text colour, so it reads on every shade and beside today's ring. */
.tile.picked { box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--text-primary); z-index: 1; }
.tile.today.picked { box-shadow: inset 0 0 0 2px var(--color-action), 0 0 0 2px var(--color-surface), 0 0 0 4px var(--text-primary); }
.tile.future { color: var(--text-tertiary); }
/* A planned day opens like any other. It has no shade yet, so it reads one step quieter than a judged day. */
.tile.s-future { color: var(--text-secondary); }
.tile.today { box-shadow: inset 0 0 0 2px var(--color-action); }
.tile.s-on { background: var(--shade-on-target); color: var(--color-on-action); }
.tile.s-close { background: var(--shade-close); color: var(--color-on-action); }
.tile.s-off { background: var(--shade-off); }
.tile.s-far { background: var(--shade-far); }
.tile.s-none { outline: 1px dashed var(--color-border); outline-offset: -1px; }
.tile.s-notarget { color: var(--text-secondary); }
.tile .mark { position: absolute; top: 4px; right: 4px; }
.corner { position: absolute; top: 4px; right: 4px; width: 0; height: 0; border-left: 7px solid transparent; border-top: 7px solid var(--over-text); }
.under { display: grid; margin-top: var(--space-xs); }
.under > * { grid-area: 1 / 1; min-width: 0; }
.key { display: flex; flex-direction: column; gap: var(--space-s); }
.key.gone { visibility: hidden; }
.legend { display: flex; flex-wrap: wrap; gap: var(--space-s) var(--space-m); min-width: 0; }
.legend span { display: inline-flex; align-items: center; gap: var(--space-s); min-height: 16px; white-space: nowrap; }
.legend .scale { gap: 2px; }
.legend .scale .sw:last-of-type { margin-right: var(--space-s); }
.sw {
  width: 12px; height: 12px; border-radius: 3px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
}
.sw.on { background: var(--shade-on-target); color: var(--color-on-action); }
.sw.close { background: var(--shade-close); }
.sw.off { background: var(--shade-off); }
.sw.far { background: var(--shade-far); }
.sw.none { background: transparent; outline: 1px dashed var(--color-border); outline-offset: -2px; }
.sw.notarget { background: transparent; box-shadow: inset 0 0 0 1px var(--text-secondary); }
.tri { width: 0; height: 0; border-left: 7px solid transparent; border-top: 7px solid var(--over-text); }
.st { width: 12px; height: 12px; border-radius: var(--radius-pill); flex: none; }
.st.done { background: var(--color-action); }
.st.planned { box-shadow: inset 0 0 0 1.5px var(--text-tertiary); }
.st.skipped { background: var(--over-text); }
.pstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-top: var(--space-m); margin-top: var(--space-xs); border-top: 1px solid var(--color-border); }
.cell { display: flex; flex-direction: column; align-items: center; gap: var(--space-2xs); min-width: 0; text-align: center; padding: 0 var(--space-xs); }
.cell + .cell { border-left: 1px solid var(--color-border); }
.num { font-size: min(1rem, 18px); line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* At the largest text a label or note too wide for its third ends in an ellipsis, as on Home's Progress card. */
.cell .t-cap, .cell .t-capn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.dcard { display: flex; flex-direction: column; gap: var(--space-2xs); align-self: start; padding-top: var(--space-xs); border-top: 1px solid var(--color-border); }
.dhead { display: flex; align-items: center; gap: var(--space-s); min-height: var(--control-chip); }
/* Open day and × keep their 44px hits but take only the 30px row, so the card is no taller than the key it covers. */
.dhead > .btn.sm { margin-block: calc((var(--control-chip) - var(--control-hit)) / 2); }
.dtitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xbtn { width: var(--control-hit); height: var(--control-hit); margin: calc((var(--control-chip) - var(--control-hit)) / 2) calc(-1 * var(--space-s)) calc((var(--control-chip) - var(--control-hit)) / 2) 0; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-pill); color: var(--text-secondary); flex: none; }
.drow { display: flex; align-items: center; gap: var(--space-s); min-height: var(--control-chip); }
.dic { width: var(--badge-l); height: var(--badge-l); display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; }
.grab {
  position: relative; z-index: 1;
  min-width: 44px; min-height: var(--control-hit); align-self: center;
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2xs);
  color: var(--text-secondary);
  /* The 44px box stays centered under the strip, same as before. Pull the empty
     hit under the icon (11px) and the unpainted part of the 16px chevron (5px,
     measured to the stroke) out of the layout so the screen gap starts at the ink. */
  margin-bottom: calc((var(--space-xs) + var(--space-2xs) + var(--space-l) - var(--control-hit)) / 2 - var(--space-xs));
}
.grab-bar { width: 36px; height: 4px; border-radius: 2px; background: var(--color-border-strong); }
.chev { transition: transform 340ms cubic-bezier(0.22, 1.05, 0.36, 1); }
.chev.up { transform: rotate(180deg); }
.still .stage, .still .face, .still .chev, .still .track { transition: none; }
</style>
