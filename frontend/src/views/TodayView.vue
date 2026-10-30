<script setup lang="ts">
import { computed, onMounted } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import FreshStart from "../components/FreshStart.vue";
import GoalReached from "../components/GoalReached.vue";
import Icon from "../components/Icon.vue";
import InfoTip from "../components/InfoTip.vue";
import MacroBars from "../components/MacroBars.vue";
import Sparkline from "../components/Sparkline.vue";
import Timeline from "../components/Timeline.vue";
import WeightChart from "../components/WeightChart.vue";
import { longDate, shortDate, todayIso } from "../lib/dates";
import { int, kg } from "../lib/format";
import { macroStatus } from "../lib/macros";
import { freshDismissed, goalDismissed, promptState } from "../lib/prompts";
import { vp } from "../lib/viewport";
import { isFreshStart, isLowAccuracy, trendChange, weightSubtitle } from "../lib/weightDisplay";
import { boot } from "../state/boot";
import { dayTotals, hasLog, loadToday, log } from "../state/log";
import { profile } from "../state/profile";
import { openFood, openWeight } from "../ui";

const weight = computed(() => profile.weight);
const low = computed(() => isLowAccuracy(weight.value));
const fresh = computed(() => isFreshStart(weight.value));
const shown = computed(() => weight.value?.trendKg != null);
const week = computed(() => trendChange(profile.chart?.series, 7, fresh.value));
const subtitle = computed(() => weightSubtitle(weight.value?.latestKg ?? null, fresh.value, low.value, week.value));
const aria = computed(() => {
  if (!shown.value || weight.value?.trendKg == null) return "Log weight";
  const spoken = subtitle.value.replace("kg/wk", "kg this week");
  return `Weight trend ${kg(weight.value.trendKg)} kg${low.value ? ", low accuracy" : ""}. ${spoken}. Open weight`;
});
const showFresh = computed(() => {
  promptState.fresh;
  const start = weight.value?.freshStart;
  return !!start?.recalculatePending && !freshDismissed(boot.accountId, start.date);
});
const showGoal = computed(() => {
  promptState.goal;
  const latest = weight.value?.latestDate;
  const goal = profile.saved?.goalWeightKg;
  if (!weight.value?.goalReached || !latest || goal == null) return false;
  return !goalDismissed(boot.accountId, latest, String(goal));
});
const tip = "The trend smooths out day-to-day swings from water, salt and food. Each weigh-in moves it 10% of the way, so one high or low reading barely changes it. Your targets use the trend, not single weigh-ins.";
const today = computed(() => profile.weight?.asOf || todayIso());
const eaten = computed(() => dayTotals());
const goal = computed(() => profile.targets);
const left = computed(() => (goal.value ? goal.value.kcal - eaten.value.kcal : 0));
const kcalStatus = computed(() => (goal.value && hasLog() ? macroStatus("kcal", eaten.value.kcal, goal.value.kcal) : "under"));
const kcalLabel = computed(() => {
  if (!goal.value) return `${int(eaten.value.kcal)} kcal eaten, no target on this day`;
  const side = left.value >= 0 ? `${int(left.value)} left` : `${int(-left.value)} over`;
  const status = kcalStatus.value === "hit" ? ", on target" : kcalStatus.value === "over" ? ", over target" : "";
  return `Today: ${int(eaten.value.kcal)} of ${int(goal.value.kcal)} kcal, ${side}${status}`;
});
onMounted(() => { void loadToday(); });
</script>

<template>
  <main class="screen today">
    <header class="col gap2">
      <span class="t-cap c2">{{ weight?.asOf ? longDate(weight.asOf) : "Today" }}</span>
      <h1 class="t-title">Today</h1>
    </header>

    <FreshStart v-if="showFresh" />
    <GoalReached v-if="showGoal" />

    <section v-if="log.loading && !log.loaded" class="card kcal" aria-busy="true" aria-label="Loading today">
      <span class="sk tall" />
      <span class="sk" />
    </section>
    <template v-else>
      <section v-if="!goal" class="card kcal">
        <span class="t-dxl num" data-num>{{ int(eaten.kcal) }}</span>
        <span class="t-label c2">kcal eaten · no target on this day</span>
      </section>
      <section v-else class="card kcal" :class="{ isover: kcalStatus === 'over' }" role="group" :aria-label="kcalLabel">
        <div class="row end">
          <div class="col">
            <span class="t-dxl num" data-num>{{ int(Math.abs(left)) }}</span>
            <span class="row gap8 tags">
              <span class="t-label c2">{{ left >= 0 ? "kcal left" : "kcal over" }}</span>
              <span v-if="kcalStatus === 'over'" class="overtag t-capn">Over target</span>
              <span v-else-if="kcalStatus === 'hit'" class="hittag t-capn"><Icon name="check" :size="11" :sw="3" aria-hidden="true" /> On target ±5%</span>
            </span>
          </div>
          <span class="grow" />
          <div class="col right gap8">
            <div class="col right"><span class="t-ns" data-num>{{ int(eaten.kcal) }}</span><span class="t-capn c3">eaten</span></div>
            <div class="col right"><span class="t-ns" data-num>{{ int(goal.kcal) }}</span><span class="t-capn c2">{{ today === todayIso() ? "target" : "that day's target" }}</span></div>
          </div>
        </div>
      </section>
      <MacroBars v-if="log.loaded" />
      <button v-if="!vp.tablet && !hasLog()" type="button" class="card prompt row" @click="openFood()">
        <span class="pic"><Icon name="plus" :size="18" :sw="2.6" /></span>
        <span class="col grow">
          <span class="t-bodys">Log your first food today</span>
          <span class="t-capn c2">Search, pick a recent food or add a saved group</span>
        </span>
        <Icon name="right" :size="16" class="c3" />
      </button>
      <section v-if="!vp.tablet && hasLog()" class="card logc">
        <span class="t-cap c3">Log · {{ shortDate(today) }}</span>
        <Timeline compact />
      </section>
    </template>

    <div v-if="!vp.tablet" class="card wcard row">
      <button type="button" class="stretch" :aria-label="aria" @click="openWeight()" />
      <div v-if="shown && weight" class="col gap2">
        <span class="row gap6 trendline"><span class="t-cap c2">Weight · trend</span><InfoTip label="What is the trend?">{{ tip }}</InfoTip></span>
        <span class="row gap8 numrow">
          <span class="base"><span class="t-nm">{{ kg(weight.trendKg!) }}</span><span class="t-label c2">kg</span></span>
          <AccuracyDot v-if="low" />
        </span>
        <span class="t-capn c2 nowrap wsub">{{ subtitle }}</span>
      </div>
      <div v-else class="col gap2">
        <span class="t-cap c2">Weight</span>
        <span class="t-head">No weigh-ins yet</span>
        <span class="t-capn c2">Log your weight to start a trend</span>
      </div>
      <span class="grow" />
      <Sparkline v-if="shown && profile.chart" :series="profile.chart.series" />
      <span v-else class="chip t-label">Weigh in</span>
      <Icon name="right" :size="16" class="c3" />
    </div>

    <div v-else class="card wbig">
      <button type="button" class="stretch" :aria-label="aria" @click="openWeight()" />
      <div class="row top">
        <div v-if="shown && weight" class="col gap2">
          <span class="row gap6 trendline"><span class="t-cap c2">Weight · trend</span><InfoTip label="What is the trend?">{{ tip }}</InfoTip></span>
          <span class="row gap8 numrow">
            <span class="base"><span class="t-nm">{{ kg(weight.trendKg!) }}</span><span class="t-label c2">kg</span></span>
            <AccuracyDot v-if="low" label />
          </span>
          <span class="t-capn c2 wsub">{{ subtitle }}</span>
        </div>
        <div v-else class="col gap2">
          <span class="t-cap c2">Weight</span>
          <span class="t-head">No weigh-ins yet</span>
          <span class="t-capn c2">Log your weight to start a trend</span>
        </div>
        <span class="grow" />
        <span class="chip t-label">Log weight</span>
      </div>
      <WeightChart v-if="shown && profile.chart" :series="profile.chart.series" fluid :height="140" />
      <p v-else class="t-label c2 m0">Your 30-day chart appears here after a weigh-in.</p>
      <p class="t-capn c2 m0">{{ tip }}</p>
    </div>

    <section v-if="vp.tablet && log.loaded" class="card logc">
      <span class="t-cap c3">Log · {{ shortDate(today) }}</span>
      <Timeline compact show-empty />
    </section>
  </main>
</template>

<style scoped>
.gap2 { gap: 2px; }
.gap6 { gap: 6px; }
.gap8 { gap: 8px; }
.m0 { margin: 0; }
.kcal { padding: 20px 16px; gap: 4px; min-width: 0; }
.end { align-items: flex-end; flex-wrap: wrap; }
.right { align-items: flex-end; }
.tags { flex-wrap: wrap; }
.overtag { padding: 2px 7px; border-radius: 6px; border: 1px dashed var(--text-secondary); color: var(--text-secondary); }
.hittag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 6px; background: var(--color-surface-2); color: var(--text-primary); }
.prompt { flex-direction: row; align-items: center; gap: 12px; text-align: left; width: 100%; min-width: 0; }
.pic { width: 44px; height: 44px; border-radius: 22px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; flex: none; }
.sk { display: block; height: 12px; width: 40%; border-radius: 6px; background: var(--color-surface-2); }
.sk.tall { height: 64px; width: 55%; border-radius: 10px; }
.logc { min-width: 0; }
.t-dxl, [data-num] { max-width: 100%; overflow-wrap: anywhere; }
.wcard, .wbig { position: relative; }
.stretch { position: absolute; inset: 0; z-index: 1; }
.wcard > :not(.stretch),
.wbig > :not(.stretch) { pointer-events: none; }
.wcard > :not(.stretch) :deep(.accdot),
.wbig :deep(.accdot),
.wcard > :not(.stretch) :deep(.itip),
.wbig :deep(.itip),
.wcard > :not(.stretch) :deep(button),
.wbig :deep(button),
.wcard > :not(.stretch) :deep(a),
.wbig :deep(a),
.wcard > :not(.stretch) :deep(input),
.wbig :deep(input),
.wcard > :not(.stretch) :deep(select),
.wbig :deep(select) { pointer-events: auto; z-index: 2; }
.wcard.row { flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 12px; text-align: left; width: 100%; }
.wcard :deep(svg.spark) { flex: none; width: 132px; min-width: 132px; max-width: 132px; }
.wcard > .col { min-width: 0; }
.nowrap { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.wbig { gap: 12px; }
.top { align-items: flex-start; gap: 12px; }
.trendline { align-items: flex-start; min-width: 0; max-width: 100%; }
.trendline .t-cap { min-width: 0; }
.dt-xl .wcard > .grow { display: none; }
.dt-xl .wcard > .col { flex: 1 1 auto; min-width: 0; }
.dt-xl .trendline { flex-wrap: wrap; }
.dt-xl .trendline .t-cap { flex: 1 0 100%; min-width: 0; white-space: normal; }
.dt-xl .trendline :deep(.itip) { flex: none; align-self: flex-start; }
</style>
