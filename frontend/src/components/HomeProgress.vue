<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import ProgressChart from "./ProgressChart.vue";
import SwipePanels from "./SwipePanels.vue";
import { ApiError, getProgress, ServerUnreachable, type ProgressDay, type ProgressResponse } from "../api";
import { dayMonth, spanLabel } from "../lib/dates";
import { int } from "../lib/format";
import type { IntakeDay } from "../lib/progressChart";
import { fiberMinimum, intakeStats, isMinimum, PAGE_TITLES, PROGRESS_PAGES, type ProgressPage } from "../lib/progressCard";
import { profile } from "../state/profile";
import { weightUnit, wt, wtSigned, wtUnit } from "../state/units";
import { openWeight, toast } from "../ui";

const props = defineProps<{ selected: string }>();

const rangeKey = "gymbro-home-range";
/** The swiped page is remembered by SwipePanels under this key. */
const pageKey = "gymbro-home-progress-page";
const ranges = ["7d", "30d", "90d", "6m", "all"] as const;
type Range = (typeof ranges)[number];
const rangeLabels: Record<Range, string> = { "7d": "7d", "30d": "30d", "90d": "90d", "6m": "6m", all: "All" };
const titles = PROGRESS_PAGES.map((page) => PAGE_TITLES[page]);

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

const range = ref<Range>(readRange());
const page = ref<ProgressPage>("weight");
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
    if (error instanceof ServerUnreachable) toast("Server unreachable, try again.");
    else if (error instanceof ApiError) toast(error.message);
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
  page.value = PROGRESS_PAGES[index] ?? "weight";
}

onMounted(() => { void load(); });
watch(
  () => `${profile.weight?.latestDate ?? ""}:${profile.weight?.latestKg ?? ""}:${profile.weight?.trendKg ?? ""}`,
  () => { void load(); },
);

const days = computed<ProgressDay[]>(() => data.value?.days ?? []);
const periodText = computed(() => {
  if (!data.value) return "";
  if (range.value === "all" && span.value) return spanLabel(span.value.from, span.value.to);
  return spanLabel(data.value.from, data.value.to);
});

const fiberMin = computed(() => fiberMinimum(profile.saved?.sex));
function intakeOf(kind: Exclude<ProgressPage, "weight">): IntakeDay[] {
  return days.value.map((day) => {
    const value = kind === "kcal" ? day.kcal : kind === "protein" ? day.protein : kind === "fat" ? day.fat : kind === "carbs" ? day.carbs : day.fiber;
    const target = kind === "kcal" ? day.targetKcal : kind === "protein" ? day.targetProtein : kind === "fat" ? day.targetFat : kind === "carbs" ? day.targetCarbs : fiberMin.value;
    return { date: day.date, logged: day.logged, value: value ?? null, target: target ?? null };
  });
}
const intake = computed(() => Object.fromEntries(PROGRESS_PAGES.filter((item) => item !== "weight")
  .map((item) => [item, intakeOf(item as Exclude<ProgressPage, "weight">)])) as Record<Exclude<ProgressPage, "weight">, IntakeDay[]>);
function unitOf(item: ProgressPage) {
  return item === "kcal" ? "kcal" : item === "weight" ? weightUnit() : "g";
}

interface Stat { label: string; value: string; sub: string }
const lastTrend = computed(() => {
  for (let index = days.value.length - 1; index >= 0; index -= 1) {
    const value = days.value[index].trendKg;
    if (value != null) return value;
  }
  return null;
});
function statsOf(item: ProgressPage): Stat[] {
  if (item === "weight") {
    const latest = data.value?.weight.currentKg;
    const change = data.value?.weight.trendChangeKg;
    const count = data.value?.weight.weighIns.length ?? 0;
    return [
      { label: "Trend", value: lastTrend.value == null ? "–" : wtUnit(lastTrend.value), sub: latest == null ? "no weigh-in" : `latest ${wt(latest)}` },
      { label: "Change", value: change == null ? "–" : `${wtSigned(change)} ${weightUnit()}`, sub: data.value ? `since ${dayMonth(data.value.from)}` : "" },
      { label: "Weigh-ins", value: String(count), sub: `in ${days.value.length} days` },
    ];
  }
  const minimum = isMinimum(item);
  const stats = intakeStats(intake.value[item], minimum);
  const unit = item === "kcal" ? "" : " g";
  const goal = stats.target == null
    ? (minimum ? "no minimum" : "no target")
    : item === "kcal" ? `of ${int(stats.target)}` : `${minimum ? "min" : "target"} ${int(stats.target)} g`;
  return [
    { label: "Average", value: stats.average == null ? "–" : `${int(stats.average)}${unit}`, sub: goal },
    { label: minimum ? "Reached min" : "On target", value: `${stats.hit} ${stats.hit === 1 ? "day" : "days"}`, sub: minimum ? `of ${stats.logged} logged` : "within ±10%" },
    { label: "Logged", value: `${stats.logged} ${stats.logged === 1 ? "day" : "days"}`, sub: `of ${stats.total}` },
  ];
}
</script>

<template>
  <section class="card home-progress" aria-label="Progress">
    <div class="row head">
      <h2 class="section-title panel-title ttl" data-progress-title>{{ PAGE_TITLES[page] }}</h2>
      <span v-if="periodText" class="t-capn c3 period">{{ periodText }}</span>
      <span class="grow" />
      <button type="button" class="weigh" @click="openWeight()">
        <Icon name="scale" :size="15" />
        <span class="t-label">Weigh in</span>
      </button>
    </div>

    <div class="seg" role="radiogroup" aria-label="Chart range">
      <button v-for="item in ranges" :key="item" type="button" role="radio" class="segb t-label"
        :class="{ on: range === item }" :aria-checked="range === item" @click="pickRange(item)">{{ rangeLabels[item] }}</button>
    </div>

    <p v-if="!data && !failed" class="t-body c2 msg">Loading progress…</p>
    <p v-else-if="failed && !data" class="t-body c2 msg">Progress couldn't be loaded.</p>
    <SwipePanels
      v-else
      :count="PROGRESS_PAGES.length"
      :lock-index="0"
      remember
      :storage-key="pageKey"
      :names="titles"
      label="Progress charts"
      tight
      @change="onPage"
    >
      <div v-for="item in PROGRESS_PAGES" :key="item" class="ppage" :data-page="item" role="group" :aria-label="PAGE_TITLES[item]" :aria-hidden="item === page ? undefined : 'true'">
        <ProgressChart
          v-model:pan="pan"
          :page="item"
          :title="PAGE_TITLES[item]"
          :range="range"
          :days="days"
          :intake="item === 'weight' ? [] : intake[item]"
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
.home-progress { gap: 10px; padding-bottom: 6px; min-width: 0; }
.head { gap: 8px; min-width: 0; align-items: center; margin: -6px 0 -4px; }
.ttl { margin: 0; flex: none; }
.period { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.weigh {
  min-height: 44px; padding: 0 12px; flex: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-primary); background: transparent; position: relative; isolation: isolate; white-space: nowrap;
}
.weigh::before { content: ""; position: absolute; z-index: -1; left: 0; right: 0; top: 6px; bottom: 6px; border-radius: 16px; background: var(--color-surface-2); }
/* Same look as Search / Quick Add in the Add food sheet: one track, the picked range in white.
   Each segment is a full 44px target; the inset shadow draws the white pill inside it. */
.seg { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-radius: var(--radius-control); background: var(--color-surface-2); min-width: 0; }
.segb { min-height: 44px; border-radius: var(--radius-control); color: var(--text-secondary); background: transparent; }
.segb.on { background: var(--color-action); color: var(--color-on-action); font-weight: 600; box-shadow: inset 0 0 0 4px var(--color-surface-2); }
.msg { margin: 0; min-height: 200px; display: flex; align-items: center; justify-content: center; }
.ppage { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cell { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; text-align: center; padding: 0 4px; }
.cell + .cell { border-left: 1px solid var(--color-border); }
.num { font-size: min(1rem, 18px); line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cell .t-capn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
</style>
