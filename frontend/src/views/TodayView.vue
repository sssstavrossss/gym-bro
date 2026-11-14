<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import Bar from "../components/Bar.vue";
import FreshStart from "../components/FreshStart.vue";
import HomeProgress from "../components/HomeProgress.vue";
import GoalReached from "../components/GoalReached.vue";
import Icon from "../components/Icon.vue";
import InfoTip from "../components/InfoTip.vue";
import MacroBars from "../components/MacroBars.vue";
import ManualTag from "../components/ManualTag.vue";
import Sparkline from "../components/Sparkline.vue";
import Timeline from "../components/Timeline.vue";
import WeekStrip from "../components/WeekStrip.vue";
import WeightChart from "../components/WeightChart.vue";
import { addDays, dayNum, diffDays, shortDate, todayInZone, weekday, weekdayShort, weekStart } from "../lib/dates";
import { int, kg } from "../lib/format";
import { screenLayoutFromFlags } from "../lib/layout";
import { freshDismissed, goalDismissed, promptState } from "../lib/prompts";
import { isManualTarget } from "../lib/manualTarget";
import { judgeWeekDay } from "../lib/weekCard";
import { vp } from "../lib/viewport";
import { isFreshStart, isLowAccuracy, trendChange, weightSubtitle } from "../lib/weightDisplay";
import { boot } from "../state/boot";
import { refreshInbox } from "../state/inbox";
import { loadDay, pendingFor, totalsOf, viewed } from "../state/log";
import { deviceTimeZone, profile } from "../state/profile";
import { loadWeekDays, weekCache } from "../state/week";
import { useRoute } from "vue-router";
import { openFood, openRecalculate, openWeight, ui } from "../ui";

const route = useRoute();
onMounted(() => {
  if (route.query.recalculate === "1") openRecalculate();
  void refreshInbox();
});
watch(() => route.query.recalculate, (value) => {
  if (value === "1") openRecalculate();
});

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
const today = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const selected = ref(today.value);
watch(today, (value) => {
  if (selected.value > value) selected.value = value;
});
watch(selected, (value) => { void loadDay(value); }, { immediate: true });
const shownDay = computed(() => (viewed.loaded && viewed.date ? viewed.date : selected.value));
const ready = computed(() => viewed.loaded);
const entries = computed(() => (ready.value ? viewed.entries : []));
const pending = computed(() => pendingFor(shownDay.value));
const goal = computed(() => (ready.value ? viewed.target : null));
const hasDay = computed(() => entries.value.length > 0 || pending.value.length > 0);
const title = computed(() => pageTitle(selected.value, today.value));
function pageTitle(day: string, now: string) {
  if (!day || day === now) return "Today";
  if (day === addDays(now, -1)) return "Yesterday";
  if (Math.abs(diffDays(now, day)) <= 6) return weekday(day);
  return shortDate(day);
}
const foodTitle = computed(() => {
  if (shownDay.value === today.value) return "Foods today";
  if (shownDay.value === addDays(today.value, -1)) return "Foods yesterday";
  return `Foods ${weekday(shownDay.value)}`;
});
function pick(day: string) {
  selected.value = day;
}
const layout = computed(() => screenLayoutFromFlags({ tablet: vp.tablet, desktop: vp.desktop, wide: vp.wide }));
const weekDates = computed(() => {
  const start = weekStart(today.value || "1970-01-01");
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
});
watch(
  [layout, today, () => viewed.loggedDates.join("|")],
  () => {
    if (layout.value === "phone" || layout.value === "tablet" || !today.value) return;
    const dates = weekDates.value.filter((date) => date <= today.value);
    void loadWeekDays(dates, new Set(viewed.loggedDates));
  },
  { immediate: true },
);
const manualSelected = computed(() => ready.value && isManualTarget(viewed.target?.reasons));
const weekHasManual = computed(() => weekRows.value.some((row) => !row.future && row.manual));
const logHref = computed(() => `/log/${selected.value}`);
const weekRows = computed(() => {
  weekCache.stamp;
  return weekDates.value.map((date) => {
    const future = date > today.value;
    const live = viewed.loaded && viewed.date === date;
    const cached = weekCache.days[date];
    const known = live || cached != null;
    const liveEntries = live ? viewed.entries : [];
    const liveTotals = totalsOf(liveEntries);
    const logged = live
      ? liveEntries.length > 0 || pendingFor(date).length > 0
      : Boolean(cached?.logged);
    const food = live
      ? { kcal: liveTotals.kcal, protein: liveTotals.p, fat: liveTotals.f, carbs: liveTotals.c }
      : cached?.eaten ?? null;
    const goalForDay = live
      ? (viewed.target ? { kcal: viewed.target.kcal, protein: viewed.target.protein, fat: viewed.target.fat, carbs: viewed.target.carbs } : null)
      : cached?.target ?? null;
    const manual = !future && (live ? isManualTarget(viewed.target?.reasons) : Boolean(cached?.manual));
    const judged = judgeWeekDay({
      date,
      today: today.value,
      logged: known && logged,
      eaten: known ? food : null,
      target: known && !future ? goalForDay : null,
    });
    const name = `${weekdayShort(date)} ${dayNum(date)}`;
    let detail = ", later";
    if (!future && !known) detail = ", loading";
    else if (!future && !logged) detail = ", nothing logged";
    else if (!future && judged.targetKcal == null) detail = " kcal, no target";
    else if (!future && judged.on) detail = ` of ${int(judged.targetKcal ?? 0)}, on target`;
    else if (!future && judged.over) detail = ` of ${int(judged.targetKcal ?? 0)}, over`;
    else if (!future) detail = ` of ${int(judged.targetKcal ?? 0)}`;
    return { date, name, detail, pending: !future && !known, kcal: food?.kcal ?? 0, manual, ...judged };
  });
});
</script>

<template>
  <main class="screen today" :class="layout" :aria-label="title">
    <header class="screen-head homehead">
      <h1 class="t-title">
        <button v-if="layout === 'phone' && selected !== today" type="button" class="titlebtn" @click="selected = today">{{ title }}</button>
        <template v-else>{{ title }}</template>
      </h1>
    </header>
    <div class="topbar">
      <WeekStrip :anchor="today" :swipe="layout === 'phone'" :selected="selected" :today="today" :setup-date="viewed.setupDate" :logged-dates="viewed.loggedDates" @select="pick" />
    </div>

    <div class="grid">
      <div class="stack c-a">
        <FreshStart v-if="showFresh && selected === today" />
        <GoalReached v-if="showGoal && selected === today" />

        <section v-if="!ready" class="card macros" aria-busy="true" aria-label="Loading today">
          <span class="sk" />
          <span class="sk" />
        </section>
        <div v-else class="daycards" :class="{ stale: viewed.dim }" data-day-cards>
          <MacroBars :manual="manualSelected" :target="goal" :totals="totalsOf(entries)" :entries="entries" :label="shownDay === today ? 'Today\'s macros' : 'That day\'s macros'" />
          <button v-if="layout === 'phone' && !hasDay" type="button" class="card prompt row" @click="openFood('search', shownDay)">
            <span class="pic"><Icon name="plus" :size="18" :sw="2.6" /></span>
            <span class="col grow">
              <span class="t-bodys">{{ shownDay === today ? "Log your first food today" : "Nothing logged this day" }}</span>
              <span class="t-capn c2">Search, pick a recent food or add a saved group</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
          <section v-if="layout === 'phone' && hasDay" class="card logc">
            <h2 class="foods t-label c2">{{ foodTitle }}</h2>
            <Timeline home compact :date="shownDay" :today="today" :entries="entries" :pending="pending" />
          </section>
        </div>

        <HomeProgress v-if="layout === 'phone'" :selected="selected" />
      </div>

      <div v-if="layout !== 'phone'" class="stack c-b">
        <div class="card wbig">
          <button type="button" class="stretch" :aria-label="aria" @click="openWeight()" />
          <div class="row top">
            <div v-if="shown && weight" class="col gap2">
              <span class="row trendline"><span class="t-cap c2">Weight · trend</span><InfoTip label="What is the trend?">{{ tip }}</InfoTip></span>
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

        <section v-if="layout === 'two' || layout === 'three'" class="card weekc" aria-labelledby="week-heading">
          <div class="row weekhead">
            <h2 id="week-heading" class="t-cap c2">This week</h2>
            <span class="t-capn c2 legend">line = that day's target · ✓ on · hatched = over{{ weekHasManual ? " · M = manual" : "" }}</span>
          </div>
          <button
            v-for="row in weekRows"
            :key="row.date"
            type="button"
            class="row wrow"
            :class="{ sel: row.date === selected }"
            :disabled="row.future"
            :aria-pressed="row.date === selected"
            @click="pick(row.date)"
          >
            <span class="t-label wl" :class="row.date === selected ? '' : 'c2'">{{ row.name }}</span>
            <div v-if="row.pending" class="grow barw"><span class="t-capn c2">…</span></div>
            <div v-else-if="row.targetKcal == null" class="grow barw"><span class="t-capn c2">{{ row.future ? "–" : "no target" }}</span></div>
            <div v-else class="grow barw">
              <Bar v-if="row.logged && row.bar != null" :pct="row.bar" :hit="row.on" :over="row.over" />
              <span class="tgt" aria-hidden="true" />
            </div>
            <span class="wm"><ManualTag v-if="!row.future && row.manual" short /></span>
            <span class="wst" aria-hidden="true"><Icon v-if="row.on" name="check" :size="12" :sw="3" /></span>
            <span v-if="row.over" class="t-capn c2">+</span>
            <span class="t-bodys wk" :class="{ c2: row.future || !row.logged }">{{ row.logged ? int(row.kcal) : "–" }}</span>
            <span class="sr-only">{{ row.detail }}</span>
          </button>
        </section>
      </div>

      <section v-if="layout !== 'phone' && ready" class="card logc c-c">
        <div class="row loghead">
          <h2 class="foods t-label c2">{{ foodTitle }}</h2>
          <span class="grow" />
          <RouterLink :to="logHref" class="t-label c2 more">Open log <Icon name="right" :size="14" /></RouterLink>
        </div>
        <Timeline home compact show-empty :date="shownDay" :today="today" :entries="entries" :pending="pending" />
      </section>
    </div>
  </main>
</template>

<style scoped>
.grid, .stack, .topbar, .daycards { display: flex; flex-direction: column; gap: var(--space-gap); min-width: 0; }
.daycards.stale { opacity: 0.55; }
.tablet .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.tablet .c-c { grid-column: 1 / -1; }
.two .topbar, .three .topbar { flex-direction: row; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.two .topbar :deep(.week), .three .topbar :deep(.week) { flex: 0 1 auto; min-width: 0; }
.two .grid { display: grid; grid-template-columns: minmax(0, 400px) minmax(0, 1fr); grid-template-areas: "a c" "b c"; gap: 20px; align-items: start; }
.two .c-a { grid-area: a; }
.two .c-b { grid-area: b; }
.two .c-c { grid-area: c; }
.three .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.25fr); gap: 20px; align-items: start; }
.two .stack, .three .stack { gap: 20px; }
.weekc { gap: 4px; min-width: 0; }
.weekhead { justify-content: space-between; gap: 8px; flex-wrap: wrap; min-width: 0; }
.weekhead h2 { margin: 0; }
.legend { min-width: 0; overflow-wrap: anywhere; }
.wrow { gap: 8px; min-height: 44px; width: 100%; min-width: 0; border-radius: 8px; text-align: left; }
.wrow:disabled { cursor: default; }
.wrow.sel { background: var(--color-surface-2); }
.wl { width: 4.5rem; flex: none; }
.tgl { gap: var(--space-gap); align-items: center; }
.wm { width: 18px; flex: none; display: inline-flex; align-items: center; }
.wst { width: 14px; flex: none; display: inline-flex; justify-content: center; }
.loghead { min-height: 44px; align-items: center; }
.foods { margin: 0; text-align: left; }
.more { display: inline-flex; align-items: center; gap: calc(var(--space-gap) / 2); min-height: var(--control-hit); padding: 0 calc(var(--space-gap) / 2); text-decoration: none; color: var(--text-secondary); }
.more:hover { color: var(--text-primary); }
.wk { width: 3.4rem; text-align: right; flex: none; }
.barw { position: relative; min-width: 0; height: 10px; display: flex; align-items: center; }
.tgt { position: absolute; left: calc(100% / 1.2); top: -3px; bottom: -3px; width: 1px; background: var(--text-tertiary); }
.remind { flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-gap); min-width: 0; max-width: 100%; }
.msg { margin: 0; flex: 1 1 8rem; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.gap2 { gap: 2px; }
.gap6 { gap: 6px; }
.gap8 { gap: 8px; }
.m0 { margin: 0; }
.today { min-width: 0; max-width: 100%; }
.homehead { height: 44px; min-height: 44px; max-height: 44px; overflow: hidden; }
.homehead .t-title { margin: 0; height: 44px; display: flex; align-items: center; white-space: nowrap; line-height: 1.2; }
.titlebtn {
  min-width: 44px; height: 44px; padding: 0; margin: 0;
  display: inline-flex; align-items: center; justify-content: flex-start;
  background: none; color: inherit; font: inherit; letter-spacing: inherit; text-align: left;
}
.prompt { flex-direction: row; align-items: center; gap: 12px; text-align: left; width: 100%; min-width: 0; }
.pic { width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; flex: none; }
.sk { display: block; height: 12px; width: 40%; border-radius: 6px; background: var(--color-surface-2); }
.logc { min-width: 0; }
[data-num] { max-width: 100%; overflow-wrap: anywhere; }
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
.top { align-items: flex-start; gap: var(--space-gap); }
.trendline { align-items: center; min-width: 0; max-width: 100%; gap: var(--space-gap); }
.trendline .t-cap { min-width: 0; }
.dt-xl .wcard > .grow { display: none; }
.dt-xl .wcard > .col { flex: 1 1 auto; min-width: 0; }
.dt-xl .trendline { flex-wrap: wrap; }
.dt-xl .trendline .t-cap { flex: 1 0 100%; min-width: 0; white-space: normal; }
.dt-xl .trendline :deep(.itip) { flex: none; align-self: flex-start; }
</style>
