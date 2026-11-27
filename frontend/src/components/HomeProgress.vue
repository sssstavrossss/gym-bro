<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import ProgressChart from "./ProgressChart.vue";
import ProgressStrip from "./ProgressStrip.vue";
import SwipePanels from "./SwipePanels.vue";
import { ApiError, getProgress, type ProgressDay, type ProgressResponse } from "../api";
import { followPage, visiblePages } from "../lib/cardPages";
import { dayMonth, spanLabel } from "../lib/dates";
import { formatDecimal, int } from "../lib/format";
import { fatLimits, fatLimitsOf, sodiumLimitMg, sodiumLimitOf } from "../lib/nutrientCards";
import type { IntakeDay } from "../lib/progressChart";
import { fiberMinimum, goalKind, intakeStats, LINE_WORDS, PAGE_TITLES, PROGRESS_PAGES, WINDOW_DAYS, type IntakePage, type ProgressPage } from "../lib/progressCard";
import {
  centreOf, clampOffset, dayIndexAt, lineStrip, offsetForCentre, stripSpan, weekBarStrip, weightWindow, windowLength, windowOf, type StripShape,
} from "../lib/progressWindow";
import { rateStat } from "../lib/weightTrend";
import { cardPages, pageOrder } from "../state/cardPages";
import { connection } from "../state/connection";
import { onLogChange } from "../state/log";
import { profile } from "../state/profile";
import { weightUnit, wt, wtUnit } from "../state/units";
import { openCardPages, openOffline, openWeight, toastError } from "../ui";

const props = defineProps<{ selected: string }>();

const rangeKey = "gymbro-home-range";
/** The swiped page, as its index in PROGRESS_PAGES (appended only), so hiding pages doesn't move it. */
const pageKey = "gymbro-home-progress-page";
const ranges = ["7d", "30d", "90d", "6m", "all"] as const;
type Range = (typeof ranges)[number];
const rangeLabels: Record<Range, string> = { "7d": "7d", "30d": "30d", "90d": "90d", "6m": "6m", all: "All" };

function readRange(): Range {
  try {
    const stored = localStorage.getItem(rangeKey);
    if (stored && (ranges as readonly string[]).includes(stored)) return stored as Range;
  } catch {
    // 30d is the default either way.
  }
  return "30d";
}
/** The old metric pills saved a name ("protein"). Carry it over once as the starting page. */
function carryOldMetric() {
  try {
    if (localStorage.getItem(pageKey) != null) return;
    const old = localStorage.getItem("gymbro-home-metric");
    const index = old ? PROGRESS_PAGES.indexOf(old as ProgressPage) : -1;
    if (index >= 0) localStorage.setItem(pageKey, String(index));
  } catch {
    // Starts on Weight.
  }
}
carryOldMetric();

function readPage(): ProgressPage {
  try {
    return PROGRESS_PAGES[Number(localStorage.getItem(pageKey))] ?? "weight";
  } catch {
    return "weight";
  }
}
function savePage(item: ProgressPage) {
  try {
    localStorage.setItem(pageKey, String(PROGRESS_PAGES.indexOf(item)));
  } catch {
    // The page still changes for this visit.
  }
}

const range = ref<Range>(readRange());
/**
 * Days the window ends before today (the strip, or a held drag on the chart). Not saved: a reload or leaving Today
 * starts at now.
 */
const offset = ref(0);
/**
 * Days back to the middle of the window, kept while switching range so the stretch in view stays in view (null at
 * now, which stays at now). Set only when the window moves, so switching back and forth doesn't drift.
 */
let centre: number | null = null;
const pages = computed(() => visiblePages(PROGRESS_PAGES, cardPages.progress, pageOrder.progress));
const titles = computed(() => pages.value.map((item) => PAGE_TITLES[item]));
const page = ref<ProgressPage>(readPage());
/** Where the card opens: the saved page, or the first page if that one is hidden. */
const start = computed(() => followPage(page.value, pages.value));
const panels = ref<InstanceType<typeof SwipePanels> | null>(null);
const data = ref<ProgressResponse | null>(null);
const failed = ref(false);
const pan = ref(0);
const span = ref<{ from: string; to: string } | null>(null);
let requestId = 0;

/**
 * One load serves every range: a year (1y) for the fixed ranges, everything for All. Each window is sliced out of it,
 * so moving through time needs no request.
 */
async function load() {
  const id = ++requestId;
  failed.value = false;
  try {
    const next = await getProgress(range.value === "all" ? "all" : "1y");
    if (id !== requestId) return;
    data.value = next;
  } catch (error) {
    if (id !== requestId) return;
    failed.value = data.value == null;
    // Offline the card keeps what it shows, or says it has nothing yet; no toast on every swipe.
    if (error instanceof ApiError) toastError(error.message);
  }
}

/** A year doesn't hold all of a longer history. */
const partial = computed(() => {
  const loaded = data.value;
  return !!loaded && loaded.range !== "all" && loaded.earliest != null && loaded.from > loaded.earliest;
});

function pickRange(value: Range) {
  if (value === range.value) return;
  range.value = value;
  pan.value = 0;
  span.value = null;
  // The same stretch stays in view; All shows everything and leaves the middle for the way back.
  offset.value = value === "all" ? 0 : offsetForCentre(centre, stripSpan(value, history.value), windowLength(value, history.value));
  try {
    localStorage.setItem(rangeKey, value);
  } catch {
    // The pick still applies for this visit.
  }
  if (value === "all" && partial.value) void load();
}

function onPage(index: number) {
  page.value = pages.value[index] ?? "weight";
  savePage(page.value);
}
// Hiding, showing or moving a page keeps the card on the same page, or sends it to the first if that one went.
watch(pages, async (next) => {
  const target = followPage(page.value, next);
  await nextTick();
  panels.value?.go(target, "auto");
});

onMounted(() => { void load(); });
watch(
  () => `${profile.weight?.latestDate ?? ""}:${profile.weight?.latestKg ?? ""}:${profile.weight?.trendKg ?? ""}`,
  () => { void load(); },
);
// Adding, editing or deleting food changes the intake pages.
onLogChange(() => { void load(); });

/** Every loaded day, oldest first, ending today. */
const history = computed(() => data.value?.days.length ?? 0);
/** Days in the window: the range, or your history when that is shorter. */
const length = computed(() => windowLength(range.value, history.value));
/** The days the strip covers: your history, a year at most for the fixed ranges. */
const stripSpanDays = computed(() => stripSpan(range.value, history.value));
const stripDays = computed<ProgressDay[]>(() => (data.value?.days ?? []).slice(-stripSpanDays.value));
const shownOffset = computed(() => clampOffset(offset.value, stripSpanDays.value, length.value));
const days = computed<ProgressDay[]>(() => windowOf(stripDays.value, length.value, shownOffset.value));
const first = computed(() => days.value[0]?.date ?? "");
const last = computed(() => days.value[days.value.length - 1]?.date ?? "");
const periodText = computed(() => {
  if (!days.value.length) return "";
  if (range.value === "all" && span.value) return spanLabel(span.value.from, span.value.to);
  return spanLabel(first.value, last.value);
});
const weighIns = computed(() => data.value?.weight.weighIns ?? []);
const shownWeighIns = computed(() => weighIns.value.filter((row) => row.date >= first.value && row.date <= last.value));

/** At most one move a frame, however fast the finger goes. */
let pending: number | null = null;
let frame = 0;
let afterMove: (() => void) | null = null;
function moveTo(value: number, after?: () => void) {
  pending = value;
  afterMove = after ?? null;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const next = clampOffset(pending ?? 0, stripSpanDays.value, length.value);
    pending = null;
    if (next !== shownOffset.value) {
      offset.value = next;
      centre = centreOf(next, length.value);
    }
    const run = afterMove;
    afterMove = null;
    run?.();
  });
}
function backToNow() {
  offset.value = 0;
  centre = null;
}

type Amount = number | null | undefined;
/** Each intake page: the day's amount and its line. Saturated fat's limit follows that day's kcal target. */
const SOURCES: Record<IntakePage, { value: (day: ProgressDay) => Amount; line: (day: ProgressDay) => Amount }> = {
  kcal: { value: (day) => day.kcal, line: (day) => day.targetKcal },
  protein: { value: (day) => day.protein, line: (day) => day.targetProtein },
  fat: { value: (day) => day.fat, line: (day) => day.targetFat },
  carbs: { value: (day) => day.carbs, line: (day) => day.targetCarbs },
  fiber: { value: (day) => day.fiber, line: () => fiberMinimum(profile.saved?.sex) },
  saturatedFat: { value: (day) => day.saturatedFat, line: (day) => fatLimits(fatLimitsOf(profile.saved?.fatLimits), day.targetKcal).saturatedGrams },
  sodium: { value: (day) => day.sodiumMg, line: () => sodiumLimitMg(sodiumLimitOf(profile.saved?.sodiumLimit)) },
};
const INTAKE_PAGES = PROGRESS_PAGES.filter((item): item is IntakePage => item !== "weight" && item !== "burn");
function intakeOf(item: IntakePage, list: readonly ProgressDay[]): IntakeDay[] {
  return list.map((day) => ({ date: day.date, logged: day.logged, value: SOURCES[item].value(day) ?? null, target: SOURCES[item].line(day) ?? null }));
}
const intake = computed(() => Object.fromEntries(INTAKE_PAGES.map((item) => [item, intakeOf(item, days.value)])) as Record<IntakePage, IntakeDay[]>);
/** Each shown page's strip, drawn once per load and range (not per move). */
const strips = computed(() => {
  const list = stripDays.value;
  const dates = list.map((day) => day.date);
  return Object.fromEntries(pages.value.map((item): [ProgressPage, StripShape] => {
    if (item === "weight") return [item, lineStrip(dates, list.map((day) => ({ value: day.trendKg, spread: day.trendBandKg ?? null })))];
    if (item === "burn") return [item, lineStrip(dates, list.map((day) => ({ value: day.burnKcal ?? null, spread: day.burnSdKcal ?? null })))];
    return [item, weekBarStrip(intakeOf(item, list), goalKind(item))];
  })) as Record<ProgressPage, StripShape>;
});
function unitOf(item: ProgressPage) {
  if (item === "weight") return weightUnit();
  return item === "kcal" || item === "burn" ? "kcal" : item === "sodium" ? "mg" : "g";
}
const HIT_LABEL = { target: "On target", minimum: "Reached min", limit: "Under limit" } as const;
/** Sodium in mg as salt in g (sodium × 2.5). */
function saltText(sodiumMg: number) {
  return `${formatDecimal((sodiumMg * 2.5) / 1000, 1)} g salt`;
}

interface Stat { label: string; value: string; sub: string }
function statsOf(item: ProgressPage): Stat[] {
  if (item === "weight") {
    // Read off the window's last day. At now that is the server's own today; an earlier window shows the trend as the
    // whole series draws it there, so the line, its end and these numbers agree.
    const at = weightWindow(data.value?.days ?? [], weighIns.value, first.value, last.value);
    const now = shownOffset.value === 0 ? data.value?.weight : null;
    const trend = now ? now.trendKg : at.trendKg;
    const bandKg = now ? now.bandKg : at.bandKg;
    const latest = now ? now.currentKg : at.latestKg;
    const band = bandKg != null ? `±${wt(bandKg)} · ` : "";
    return [
      { label: "Trend", value: trend == null ? "–" : wtUnit(trend), sub: latest == null ? "no weigh-in" : `${band}latest ${wt(latest)}` },
      { label: "Rate", ...rateStat(now ? now.rateKgPerWeek : at.rateKgPerWeek, weightUnit()) },
      { label: "Weigh-ins", value: String(at.count), sub: `in ${days.value.length} days` },
    ];
  }
  if (item === "burn") {
    // The burn on the window's last day: at now, today's, which today's target is built on.
    const burn = shownOffset.value === 0 ? data.value?.burn : burnOn(days.value);
    if (!burn) return [{ label: "Burn", value: "–", sub: "no target yet" }, { label: "BMR", value: "–", sub: "at rest" }, { label: "Activity", value: "–", sub: "burn − BMR" }];
    const how = !burn.measured ? "formula" : burn.setOn ? dayMonth(burn.setOn) : "measured";
    return [
      { label: "Burn", value: int(burn.kcal), sub: `±${int(burn.sdKcal)} · ${how}` },
      { label: "BMR", value: int(burn.bmrKcal), sub: "at rest" },
      { label: "Activity", value: int(burn.kcal - burn.bmrKcal), sub: "burn − BMR" },
    ];
  }
  const kind = goalKind(item);
  const stats = intakeStats(intake.value[item], kind);
  const unit = item === "kcal" ? "" : ` ${unitOf(item)}`;
  const goal = stats.target == null
    ? `no ${kind === "minimum" ? "minimum" : kind}`
    : item === "kcal" ? `of ${int(stats.target)}` : `${LINE_WORDS[kind]} ${int(stats.target)}${unit}`;
  // Sodium's limit is on the chart, so the salt it adds up to goes under the average.
  const averageSub = item === "sodium" && stats.average != null ? saltText(stats.average) : goal;
  return [
    { label: "Average", value: stats.average == null ? "–" : `${int(stats.average)}${unit}`, sub: averageSub },
    { label: HIT_LABEL[kind], value: `${stats.hit} ${stats.hit === 1 ? "day" : "days"}`, sub: kind === "target" ? "within ±10%" : `of ${stats.logged} logged` },
    { label: "Logged", value: `${stats.logged} ${stats.logged === 1 ? "day" : "days"}`, sub: `of ${stats.total}` },
  ];
}
/** The burn in effect on the last day of `list` that has one. */
function burnOn(list: readonly ProgressDay[]) {
  for (let i = list.length - 1; i >= 0; i--) {
    const day = list[i];
    if (day.burnKcal != null && day.bmrKcal != null) return { kcal: day.burnKcal, bmrKcal: day.bmrKcal, sdKcal: day.burnSdKcal ?? 0, measured: !!day.burnMeasured, setOn: null as string | null };
  }
  return null;
}

// Hold the chart about a quarter second, then drag: the chart follows the finger a day at a time, with the day under
// it read out. Touch events, so a quick swipe stays the pages' and a held drag can take the touch from them.
const HOLD_MS = 260;
/** The y labels' column on the chart's right. */
const YCOL = 34;
const held = ref(false);
const readout = ref<{ x: number; label: number; text: string; date: string } | null>(null);
let hold: null | { x: number; y: number; lastX: number; timer: number; active: boolean; from: number; el: HTMLElement; item: ProgressPage; track: HTMLElement | null } = null;
/** Whether the chart can be held: not while All scrolls sideways itself. */
const holdable = computed(() => range.value !== "all" || days.value.length <= WINDOW_DAYS);

function readoutText(item: ProgressPage, day: ProgressDay) {
  const date = dayMonth(day.date);
  if (item === "weight") return `${date} · ${day.trendKg == null ? "no trend" : wtUnit(day.trendKg)}`;
  if (item === "burn") return `${date} · ${day.burnKcal == null ? "no target" : `${int(day.burnKcal)} kcal`}`;
  const value = SOURCES[item].value(day);
  return `${date} · ${!day.logged || value == null ? "not logged" : `${int(value)} ${unitOf(item)}`}`;
}
function readAt(el: HTMLElement, clientX: number, item: ProgressPage) {
  const rect = el.getBoundingClientRect();
  const plot = rect.width - YCOL;
  const x = Math.max(0, Math.min(plot - 1, clientX - rect.left));
  const day = days.value[dayIndexAt(x, plot, days.value.length)];
  if (!day) return;
  // The pill stays inside the plot; the line marks the day.
  readout.value = { x, label: Math.max(64, Math.min(plot - 64, x)), date: day.date, text: readoutText(item, day) };
}
function holdStart(event: TouchEvent, item: ProgressPage) {
  if (!holdable.value || event.touches.length !== 1) return;
  const el = event.currentTarget as HTMLElement;
  const point = event.touches[0];
  const timer = window.setTimeout(() => {
    if (!hold) return;
    hold.active = true;
    hold.from = shownOffset.value;
    held.value = true;
    // The touch is the chart's now: the pages stop tracking it, and can't scroll until it ends.
    hold.track?.dispatchEvent(new Event("touchcancel"));
    if (hold.track) hold.track.style.overflowX = "hidden";
    navigator.vibrate?.(8);
    readAt(el, hold.lastX, item);
  }, HOLD_MS);
  hold = { x: point.clientX, y: point.clientY, lastX: point.clientX, active: false, from: shownOffset.value, el, item, track: el.closest(".track"), timer };
}
function holdMove(event: TouchEvent) {
  if (!hold) return;
  const point = event.touches[0];
  const dx = point.clientX - hold.x;
  hold.lastX = point.clientX;
  if (!hold.active) {
    // Moved before the hold: a swipe or a scroll, not a hold.
    if (Math.hypot(dx, point.clientY - hold.y) > 8) endHold();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const { el, item } = hold;
  const plot = el.getBoundingClientRect().width - YCOL;
  // Drag right to see earlier days, as if pulling the chart along.
  if (range.value === "all") readAt(el, point.clientX, item);
  else moveTo(hold.from + dx / (plot / length.value), () => readAt(el, point.clientX, item));
}
function endHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.active) {
    if (hold.track) hold.track.style.overflowX = "";
    held.value = false;
    readout.value = null;
  }
  hold = null;
}
function holdEnd(event: TouchEvent) {
  if (hold?.active) event.stopPropagation();
  endHold();
}
const wired = new WeakSet<HTMLElement>();
function chartRef(item: ProgressPage) {
  return (el: unknown) => {
    if (!(el instanceof HTMLElement) || wired.has(el)) return;
    wired.add(el);
    el.addEventListener("touchstart", (event) => holdStart(event, item), { passive: true });
    el.addEventListener("touchmove", holdMove, { passive: false });
    el.addEventListener("touchend", holdEnd);
    el.addEventListener("touchcancel", holdEnd);
    el.addEventListener("contextmenu", (event) => { if (hold) event.preventDefault(); });
  };
}
onBeforeUnmount(() => {
  endHold();
  cancelAnimationFrame(frame);
});
</script>

<template>
  <section class="card home-progress" aria-label="Progress">
    <div class="chead head">
      <h2 class="section-title panel-title ttl" data-progress-title>{{ PAGE_TITLES[page] }}</h2>
      <!-- Moved back in time, the dates stand out, and tapping them comes back to now. -->
      <button
        v-if="periodText" type="button" class="t-capn period pbtn" :class="{ moved: shownOffset }" :disabled="!shownOffset"
        :aria-label="shownOffset ? `${periodText}. Back to now` : periodText" data-range-period @click="backToNow"
      >{{ periodText }}</button>
      <!-- In the head, not the swipe track, so it stays put while the pages move. -->
      <button v-if="connection.offline" type="button" class="offc c2" aria-label="Offline: these numbers are from the last time you were online" data-offline-card @click="openOffline">
        <Icon name="cloud-off" :size="16" />
      </button>
      <span class="grow" />
      <button type="button" class="btn sm primary t-label weigh" @click="openWeight()">
        <Icon name="scale" :size="14" />
        <span>Weigh in</span>
      </button>
    </div>

    <Segmented size="compact" label="Chart range" class="full ranges" :model-value="range" :options="ranges.map((item) => ({ value: item, label: rangeLabels[item] }))" @update:model-value="pickRange" />

    <p v-if="!data && !failed" class="t-body c2 msg">Loading progress…</p>
    <p v-else-if="failed && !data" class="t-body c2 msg">{{ connection.offline ? "Progress isn't on this phone yet. It loads when you're back online." : "Progress couldn't be loaded." }}</p>
    <SwipePanels
      v-else
      ref="panels"
      :count="pages.length"
      :lock-index="pages.indexOf('weight')"
      :start="start"
      :names="titles"
      label="Progress charts"
      settings="Choose progress pages"
      tight
      @change="onPage"
      @settings="openCardPages('progress')"
    >
      <div v-for="item in pages" :key="item" class="ppage" :data-page="item" role="group" :aria-label="PAGE_TITLES[item]" :aria-hidden="item === page ? undefined : 'true'">
        <div :ref="chartRef(item)" class="chartwrap" :class="{ held: held && item === page }" data-progress-chart>
          <ProgressChart
            v-model:pan="pan"
            :page="item"
            :title="PAGE_TITLES[item]"
            :range="range"
            :days="days"
            :intake="item === 'weight' || item === 'burn' ? [] : intake[item]"
            :weigh-ins="shownWeighIns"
            :selected="readout?.date ?? props.selected"
            :unit="unitOf(item)"
            @span="span = $event"
          />
          <template v-if="readout && item === page">
            <span class="xline" :style="{ left: `${readout.x}px` }" aria-hidden="true" />
            <span class="t-capn readout" :style="{ left: `${readout.label}px` }" data-progress-readout>{{ readout.text }}</span>
          </template>
        </div>
        <ProgressStrip :shape="strips[item]" :span="stripSpanDays" :length="length" :offset="shownOffset" :label="periodText" @move="moveTo" />
        <div class="pstats" :data-home-summary="item === 'weight' ? '' : undefined">
          <div v-for="stat in statsOf(item)" :key="stat.label" class="cell">
            <span class="t-cap c2">{{ stat.label }}</span>
            <span class="num" data-num>{{ stat.value }}</span>
            <span class="t-capn c2">{{ stat.sub }}</span>
          </div>
        </div>
      </div>
    </SwipePanels>
  </section>
</template>

<style scoped>
/* No bottom padding: the dot strip ends at the card's edge, with its own 6px below the dots. */
.home-progress { gap: var(--space-m); padding-bottom: 0; min-width: 0; }
.head { flex-wrap: wrap; }
.ttl { margin: 0; flex: none; }
.period { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.weigh { white-space: nowrap; }
.pbtn { padding: 0 var(--space-s); background: none; border: 0; color: var(--text-tertiary); cursor: pointer; }
.pbtn:disabled { cursor: default; opacity: 1; }
/* Moved back: the dates stand out, and tapping them comes back to now. */
.pbtn.moved { color: var(--text-primary); }
/* A 44px target that takes no more room in the head than the 16px icon. */
.offc { display: inline-grid; place-items: center; width: 44px; height: 44px; margin: -14px -12px -14px -10px; border-radius: 50%; background: none; border: 0; color: var(--text-secondary); cursor: pointer; }
/* Five equal ranges, even when a label is wider. */
.ranges :deep(.seg-btn) { flex: 1 1 0; min-width: 0; }
.msg { margin: 0; min-height: 200px; display: flex; align-items: center; justify-content: center; }
.ppage { display: flex; flex-direction: column; gap: var(--space-m); min-width: 0; }
.pstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cell { display: flex; flex-direction: column; align-items: center; gap: var(--space-2xs); min-width: 0; text-align: center; padding: 0 var(--space-xs); }
.cell + .cell { border-left: 1px solid var(--color-border); }
.num { font-size: min(1rem, 18px); line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cell .t-capn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
/* A long press on the chart must not select text or open the callout. Held, it tints so the hold reads. */
.chartwrap { position: relative; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; border-radius: var(--radius-s); transition: background-color .15s; }
.chartwrap.held { background: color-mix(in srgb, var(--color-surface-2) 70%, transparent); }
.xline { position: absolute; top: 0; bottom: 20px; width: 1px; background: var(--text-tertiary); pointer-events: none; }
.readout { position: absolute; top: 2px; padding: 2px var(--space-s); border-radius: var(--radius-pill); background: var(--color-surface-2); color: var(--text-primary); white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; translate: -50% 0; box-shadow: 0 0 0 1px var(--color-border); }
</style>
