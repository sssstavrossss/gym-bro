<script setup lang="ts">
import { computed } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import FreshStart from "../components/FreshStart.vue";
import GoalReached from "../components/GoalReached.vue";
import Sparkline from "../components/Sparkline.vue";
import WeightChart from "../components/WeightChart.vue";
import Icon from "../components/Icon.vue";
import { longDate } from "../lib/dates";
import { kg } from "../lib/format";
import { freshDismissed, goalDismissed, promptState } from "../lib/prompts";
import { vp } from "../lib/viewport";
import { isFreshStart, isLowAccuracy, trendChange, weightSubtitle } from "../lib/weightDisplay";
import { boot } from "../state/boot";
import { profile } from "../state/profile";
import { openWeight } from "../ui";

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
</script>

<template>
  <main class="screen today">
    <header class="col gap2">
      <span class="t-cap c2">{{ weight?.asOf ? longDate(weight.asOf) : "Today" }}</span>
      <h1 class="t-title">Today</h1>
    </header>

    <FreshStart v-if="showFresh" />
    <GoalReached v-if="showGoal" />

    <section class="card soon">
      <h2 class="t-head">Food log</h2>
      <p class="t-body c2 m0">Today’s food log arrives in a later update. Your targets live on Profile.</p>
    </section>

    <div v-if="!vp.tablet" class="card wcard row">
      <button type="button" class="stretch" :aria-label="aria" @click="openWeight()" />
      <div v-if="shown && weight" class="col gap2">
        <span class="row gap6"><span class="t-cap c2">Weight · trend</span></span>
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
          <span class="t-cap c2">Weight · trend</span>
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
  </main>
</template>

<style scoped>
.gap2 { gap: 2px; }
.gap6 { gap: 6px; }
.gap8 { gap: 8px; }
.m0 { margin: 0; }
.soon { gap: 6px; }
.wcard, .wbig { position: relative; }
.stretch { position: absolute; inset: 0; z-index: 1; }
.wcard > :not(.stretch),
.wbig > :not(.stretch) { pointer-events: none; }
.wcard > :not(.stretch) :deep(.accdot),
.wbig :deep(.accdot),
.wcard > :not(.stretch) :deep(button),
.wbig :deep(button),
.wcard > :not(.stretch) :deep(a),
.wbig :deep(a),
.wcard > :not(.stretch) :deep(input),
.wbig :deep(input),
.wcard > :not(.stretch) :deep(select),
.wbig :deep(select) { pointer-events: auto; z-index: 2; }
.wcard.row { flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 12px; text-align: left; width: 100%; }
.wcard :deep(svg:not(.c3)) { flex: 0 1 132px; min-width: 0; max-width: 132px; }
.wcard > .col { min-width: 0; }
.nowrap { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.wbig { gap: 12px; }
.top { align-items: flex-start; gap: 12px; }
</style>
