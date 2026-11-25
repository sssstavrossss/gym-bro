<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import ProgressChart from "./ProgressChart.vue";
import SwipePanels from "./SwipePanels.vue";
import { ApiError, getProgress, type ProgressDay, type ProgressResponse } from "../api";
import { followPage, visiblePages } from "../lib/cardPages";
import { dayMonth, spanLabel } from "../lib/dates";
import { formatDecimal, int } from "../lib/format";
import { fatLimits, fatLimitsOf, sodiumLimitMg, sodiumLimitOf } from "../lib/nutrientCards";
import type { IntakeDay } from "../lib/progressChart";
import { fiberMinimum, goalKind, intakeStats, LINE_WORDS, PAGE_TITLES, PROGRESS_PAGES, type IntakePage, type ProgressPage } from "../lib/progressCard";
import { rateStat } from "../lib/weightTrend";
import { cardPages } from "../state/cardPages";
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
const pages = computed(() => visiblePages(PROGRESS_PAGES, cardPages.progress));
const titles = computed(() => pages.value.map((item) => PAGE_TITLES[item]));
const page = ref<ProgressPage>(readPage());
/** Where the card opens: the saved page, or Weight if that page is hidden. */
const start = computed(() => followPage(page.value, pages.value));
const panels = ref<InstanceType<typeof SwipePanels> | null>(null);
const data = ref<ProgressResponse | null>(null);
const failed = ref(false);
const pan = ref(0);
const span = ref<{ from: string; to: string } | null>(null);
let requestId = 0;

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
    // Offline the card keeps what it shows, or says it has nothing yet; no toast on every swipe.
    if (error instanceof ApiError) toastError(error.message);
  }
}

function pickRange(value: Range) {
  if (value === range.value) return;
  range.value = value;
  pan.value = 0;
  span.value = null;
  try {
    localStorage.setItem(rangeKey, value);
  } catch {
    // The pick still applies for this visit.
  }
  void load();
}
function onPage(index: number) {
  page.value = pages.value[index] ?? "weight";
  savePage(page.value);
}
// Hiding or showing a page keeps the card on the same page, or sends it to Weight if that one went.
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

const days = computed<ProgressDay[]>(() => data.value?.days ?? []);
const periodText = computed(() => {
  if (!data.value) return "";
  if (range.value === "all" && span.value) return spanLabel(span.value.from, span.value.to);
  return spanLabel(data.value.from, data.value.to);
});

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
const intake = computed(() => Object.fromEntries(INTAKE_PAGES.map((item) => [item, days.value.map((day): IntakeDay => ({
  date: day.date,
  logged: day.logged,
  value: SOURCES[item].value(day) ?? null,
  target: SOURCES[item].line(day) ?? null,
}))])) as Record<IntakePage, IntakeDay[]>);
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
    const weight = data.value?.weight;
    const trend = weight?.trendKg;
    const latest = weight?.currentKg;
    const count = weight?.weighIns.length ?? 0;
    const band = weight?.bandKg != null ? `±${wt(weight.bandKg)} · ` : "";
    return [
      { label: "Trend", value: trend == null ? "–" : wtUnit(trend), sub: latest == null ? "no weigh-in" : `${band}latest ${wt(latest)}` },
      { label: "Rate", ...rateStat(weight?.rateKgPerWeek, weightUnit()) },
      { label: "Weigh-ins", value: String(count), sub: `in ${days.value.length} days` },
    ];
  }
  if (item === "burn") {
    // Today's burn, not the range's: it is what today's target is built on.
    const burn = data.value?.burn;
    if (!burn) return [{ label: "Burn", value: "–", sub: "no target yet" }, { label: "BMR", value: "–", sub: "at rest" }, { label: "Activity", value: "–", sub: "burn − BMR" }];
    return [
      { label: "Burn", value: int(burn.kcal), sub: `±${int(burn.sdKcal)} · ${burn.measured ? dayMonth(burn.setOn) : "formula"}` },
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
</script>

<template>
  <section class="card home-progress" aria-label="Progress">
    <div class="chead head">
      <h2 class="section-title panel-title ttl" data-progress-title>{{ PAGE_TITLES[page] }}</h2>
      <span v-if="periodText" class="t-capn c3 period">{{ periodText }}</span>
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
      :lock-index="0"
      :start="start"
      :names="titles"
      label="Progress charts"
      settings="Choose progress pages"
      tight
      @change="onPage"
      @settings="openCardPages('progress')"
    >
      <div v-for="item in pages" :key="item" class="ppage" :data-page="item" role="group" :aria-label="PAGE_TITLES[item]" :aria-hidden="item === page ? undefined : 'true'">
        <ProgressChart
          v-model:pan="pan"
          :page="item"
          :title="PAGE_TITLES[item]"
          :range="range"
          :days="days"
          :intake="item === 'weight' || item === 'burn' ? [] : intake[item]"
          :weigh-ins="data?.weight.weighIns ?? []"
          :selected="props.selected"
          :unit="unitOf(item)"
          @span="span = $event"
        />
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
</style>
