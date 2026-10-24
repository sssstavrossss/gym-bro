<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import Bar from "../components/Bar.vue";
import Icon from "../components/Icon.vue";
import Sparkline from "../components/Sparkline.vue";
import MacroBars from "../components/MacroBars.vue";
import Timeline from "../components/Timeline.vue";
import Skeleton from "../components/Skeleton.vue";
import InfoTip from "../components/InfoTip.vue";
import ManualTag from "../components/ManualTag.vue";
import GoalReached from "../components/GoalReached.vue";
import FreshStart from "../components/FreshStart.vue";
import AccuracyDot from "../components/AccuracyDot.vue";
import WeightChart from "../components/WeightChart.vue";
import { addDays, dayNum, longDate, shortDate, weekStart, weekday, weekdayShort } from "../lib/dates";
import { int, kg, signed } from "../lib/format";
import { vp } from "../lib/viewport";
import { dayTotals, hasLog, hasWeights, isManual, isOver, latestWeighIn, macroStatus, shadeFor, targetFor, today, lowAccuracy, trend, trendInfo, trendWeight } from "../store";
import { openFood, openWeight, ui } from "../ui";

const sel = ref(today);
const week = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i)));
const t = computed(() => dayTotals(sel.value));
const g = computed(() => targetFor(sel.value));
const left = computed(() => (g.value ? g.value.kcal - t.value.kcal : 0));
const kst = computed(() => (g.value && hasLog(sel.value) ? macroStatus("kcal", t.value.kcal, g.value.kcal) : "under"));
const title = computed(() => (sel.value === today ? "Today" : sel.value === addDays(today, -1) ? "Yesterday" : weekday(sel.value)));
const w = computed(() => {
  const latest = latestWeighIn(today);
  const prev = trend(addDays(today, -7));
  const fresh = trendInfo.value.state === "fresh_start";
  // S8: always shown once there is a weigh-in; across a fresh start there is no comparable week change
  return { trend: trendWeight.value, latest, week: prev != null && !fresh ? trendWeight.value - prev : null, shown: hasWeights.value, low: lowAccuracy.value, fresh, any: hasWeights.value };
});
/** S8: one short line under the trend (fits one line at the default text size on a 375 pt phone). */
const wSub = computed(() => {
  const l = w.value.latest ? `latest ${kg(w.value.latest.kg)}` : "";
  const tail = w.value.fresh ? "fresh start" : w.value.low ? "low accuracy" : w.value.week != null ? `${signed(w.value.week)} kg/wk` : "";
  return [l, tail].filter(Boolean).join(" · ");
});
const wAria = computed(() => `Weight trend ${kg(w.value.trend)} kg${w.value.low ? ", low accuracy" : ""}. ${wSub.value.replace("kg/wk", "kg this week")}. Open weight`);
/** No weigh-ins at all (only if the setup weigh-in was deleted; S8 Q1 makes it the first weigh-in). */
const wEmpty = { title: "No weigh-ins yet", sub: "Log your weight to start a trend" };
const loading = computed(() => ui.demo === "loading");
// This week: each day against its own target (decision 14) and the decision 7 rule.
const weekRows = computed(() => week.value.map((d) => {
  const tg = targetFor(d)?.kcal ?? null;
  return { d, kcal: dayTotals(d).kcal, tg, future: d > today, logged: hasLog(d), on: shadeFor(d) === "on", over: isOver(d) };
}));
const TREND_TIP = "The trend smooths out day-to-day swings from water, salt and food. Each weigh-in moves it 10 % of the way, so one high or low reading barely changes it. Your targets use the trend, not single weigh-ins.";
const layout = computed(() => (vp.wide ? "three" : vp.desktop ? "two" : vp.tablet ? "tablet" : "phone"));
</script>

<template>
  <main class="screen today" :class="layout">
    <div class="topbar">
      <header class="col gap2">
        <span class="row gap8"><span class="t-cap c2">{{ longDate(sel) }}</span><span class="demo-tag t-capn" title="All numbers are made up for the prototype">Demo data · fictional</span></span>
        <h1 class="t-title">{{ title }}</h1>
      </header>
      <div class="row week" role="group" aria-label="This week">
        <button v-for="d in week" :key="d" type="button" class="day" :disabled="d > today" :aria-pressed="d === sel" @click="sel = d">
          <span class="t-cap" :class="d > today ? 'c3' : 'c2'" aria-hidden="true">{{ weekday(d)[0] }}</span><span class="sr-only">{{ weekday(d) }}</span>
          <span class="circle t-bodys" :class="{ on: d === sel, future: d > today }">{{ dayNum(d) }}</span>
          <span class="sr-only">{{ d === today ? ", today" : "" }}{{ d > today ? "" : hasLog(d) ? ", logged" : ", nothing logged" }}</span>
          <span class="dot" :class="{ on: hasLog(d) && d !== sel && d < today }" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="grid">
      <div class="stack c-a">
        <section class="card kcal" aria-busy="true"><Skeleton w="55%" :h="64" :r="10" /><Skeleton w="30%" :h="12" /></section>
        <section class="card" style="gap: 16px"><template v-for="i in 4" :key="i"><div class="col" style="gap: 8px"><Skeleton w="70%" :h="12" /><Skeleton :h="4" /></div></template></section>
      </div>
      <div v-if="layout !== 'phone'" class="stack c-b"><section class="card" style="gap: 12px"><Skeleton w="40%" :h="12" /><Skeleton :h="140" :r="10" /></section></div>
      <section v-if="vp.tablet" class="card c-c" style="gap: 12px"><template v-for="i in 5" :key="i"><Skeleton :h="16" /></template></section>
    </div>
    <div v-else class="grid">
      <div class="stack c-a">
        <FreshStart v-if="sel === today" />
        <GoalReached v-if="sel === today" />
        <section v-if="!g" class="card kcal">
          <span class="t-dxl num">{{ int(t.kcal) }}</span>
          <span class="t-label c2">kcal eaten · no target on this day</span>
          <span class="t-capn c2">Days before your first target aren't judged or counted in stats.</span>
        </section>
        <section v-else class="card kcal" :class="{ isover: kst === 'over' }" :aria-label="`${title}: ${int(t.kcal)} of ${int(g.kcal)} kcal, ${left >= 0 ? `${int(left)} left` : `${int(-left)} over`}${kst === 'hit' ? ', on target' : kst === 'over' ? ', over target' : ''}`" role="group">
          <div class="row end">
            <div class="col">
              <span class="t-dxl num">{{ int(Math.abs(left)) }}</span>
              <span class="row gap8"><span class="t-label c2">{{ left >= 0 ? "kcal left" : "kcal over" }}</span>
                <span v-if="kst === 'over'" class="overtag t-capn">Over target</span>
                <span v-else-if="kst === 'hit'" class="hittag t-capn"><Icon name="check" :size="11" :sw="3" aria-hidden="true" /> On target ±5 %</span></span>
            </div>
            <span class="grow" />
            <div class="col right gap8">
              <div class="col right"><span class="t-ns">{{ int(t.kcal) }}</span><span class="t-capn c3">eaten</span></div>
              <div class="col right"><span class="t-ns">{{ int(g.kcal) }}</span><span class="row tgl"><ManualTag v-if="isManual(sel)" /><span class="t-capn c2">{{ sel === today ? "target" : "that day's target" }}</span></span></div>
            </div>
          </div>
        </section>
        <MacroBars :date="sel" />
        <!-- phone: nothing logged yet → a prompt instead of an empty log -->
        <button v-if="layout === 'phone' && !hasLog(sel)" type="button" class="card prompt row" @click="openFood({ date: sel })">
          <span class="pic"><Icon name="plus" :size="18" :sw="2.6" /></span>
          <span class="col grow"><span class="t-bodys">{{ sel === today ? "Log your first food today" : "Nothing logged this day" }}</span><span class="t-capn c2">Search, pick a recent food or add a saved group</span></span>
          <Icon name="right" :size="16" class="c3" />
        </button>
        <!-- phone: compact weight card -->
        <div v-if="layout === 'phone'" class="card wcard row">
          <button type="button" class="stretch" :aria-label="w.shown ? wAria : 'Weigh in'" @click="openWeight()" />
          <div v-if="w.shown" class="col gap2">
            <span class="row gap6"><span class="t-cap c2">Weight · trend</span><InfoTip label="What is the trend?">{{ TREND_TIP }}</InfoTip></span>
            <span class="row gap8 numrow"><span class="base"><span class="t-nm">{{ kg(w.trend) }}</span><span class="t-label c2">kg</span></span><AccuracyDot v-if="w.low" /></span>
            <span class="t-capn c3 nowrap wsub">{{ wSub }}</span>
          </div>
          <div v-else class="col gap2">
            <span class="t-cap c2">Weight</span>
            <span class="t-head">{{ wEmpty.title }}</span>
            <span class="t-capn c2">{{ wEmpty.sub }}</span>
          </div>
          <span class="grow" />
          <Sparkline v-if="w.shown" :end="today" />
          <span v-else class="chip t-label">Weigh in</span>
          <Icon name="right" :size="16" class="c3" />
        </div>
      </div>

      <div v-if="layout !== 'phone'" class="stack c-b">
        <!-- larger screens: weight card with the 30-day chart -->
        <div class="card wbig clickable">
          <button type="button" class="stretch" :aria-label="w.shown ? wAria.replace('Open weight', 'Log weight') : 'Log weight'" @click="openWeight()" />
          <div class="row top">
            <div v-if="w.shown" class="col gap2">
              <span class="row gap6"><span class="t-cap c2">Weight · trend</span><InfoTip label="What is the trend?">{{ TREND_TIP }}</InfoTip></span>
              <span class="row gap8 numrow"><span class="base"><span class="t-nm">{{ kg(w.trend) }}</span><span class="t-label c2">kg</span></span><AccuracyDot v-if="w.low" label /></span>
              <span class="t-capn c3">{{ w.latest ? `latest ${kg(w.latest.kg)}` : "" }}{{ w.fresh ? " · fresh start" : w.week != null ? ` · ${signed(w.week)} kg this week` : "" }}</span>
            </div>
            <div v-else class="col gap2">
              <span class="t-cap c2">Weight</span>
              <span class="t-head">{{ wEmpty.title }}</span>
              <span class="t-capn c2">{{ wEmpty.sub }}</span>
            </div>
            <span class="grow" />
            <span class="chip t-label">Log weight</span>
          </div>
          <WeightChart v-if="w.any" :end="today" fluid :height="140" />
          <div v-else class="wempty col"><span class="t-label c2">Your 30-day chart appears here after a few weigh-ins.</span><span class="t-capn c3">Weigh in at the same time each morning for a steady trend.</span></div>
        </div>
        <section v-if="vp.desktop" class="card weekc">
          <div class="row"><span class="t-cap c2">This week</span><span class="grow" /><span class="t-capn c2">line = that day's target · ✓ on · hatched = over{{ weekRows.some((r) => !r.future && isManual(r.d)) ? " · M = manual" : "" }}</span></div>
          <button v-for="r in weekRows" :key="r.d" type="button" class="row wrow" :class="{ sel: r.d === sel }" :disabled="r.future" :aria-pressed="r.d === sel" @click="sel = r.d">
            <span class="t-label wl" :class="r.d === sel ? '' : 'c2'">{{ weekdayShort(r.d) }} {{ dayNum(r.d) }}</span>
            <div v-if="r.tg == null" class="grow barw"><span class="t-capn c2">no target</span></div>
            <div v-else class="grow barw"><Bar v-if="!r.future && r.logged" :pct="r.kcal / (r.tg * 1.2)" :hit="r.on" :over="r.over" /><span class="tgt" /></div>
            <span class="wm"><ManualTag v-if="!r.future && isManual(r.d)" short /></span>
            <span class="wst" aria-hidden="true"><Icon v-if="r.on" name="check" :size="12" :sw="3" /><span v-else-if="r.over" class="t-capn c2">+</span></span>
            <span class="t-bodys wk" :class="{ c2: r.future || !r.logged }">{{ r.logged ? int(r.kcal) : "–" }}</span>
            <span v-if="!r.future" class="sr-only">{{ r.logged ? " kcal" : " nothing logged" }}{{ r.tg == null ? ", no target" : r.logged ? ` of ${int(r.tg)}${r.on ? ", on target" : r.over ? ", over" : ""}` : "" }}</span>
          </button>
        </section>
      </div>

      <section v-if="vp.tablet" class="card logc c-c">
        <div class="row">
          <span class="t-cap c3">Log · {{ shortDate(sel) }}</span><span class="grow" />
          <RouterLink :to="`/log/${sel}`" class="t-label c2 more">Open log <Icon name="right" :size="14" /></RouterLink>
        </div>
        <Timeline :date="sel" compact />
      </section>
    </div>
  </main>
</template>

<style scoped>
.gap2 { gap: 2px; }
.gap8 { gap: 8px; }
.grid { display: flex; flex-direction: column; gap: var(--space-gap); }
.stack { gap: var(--space-gap); }
.topbar { display: flex; flex-direction: column; gap: var(--space-gap); }
.week { justify-content: space-between; }
.day { width: 44px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.day:disabled { cursor: default; }
.circle { width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
.circle.on { background: var(--color-action); color: var(--color-on-action); }
.circle.future { color: var(--text-tertiary); }
.can-hover .day:not(:disabled):hover .circle:not(.on) { background: var(--color-surface-2); }
.dot { width: 4px; height: 4px; border-radius: 2px; }
.dot.on { background: var(--text-secondary); }
.kcal { padding: 20px 16px; gap: 4px; }
.end { align-items: flex-end; }
.right { align-items: flex-end; }
.kcal .right.gap8 { padding-bottom: 2px; }
.nowrap { white-space: nowrap; }
.gap6 { gap: 6px; }
.stretch { position: absolute; inset: 0; border-radius: inherit; z-index: 1; }
.wcard, .wbig { position: relative; }
.wcard > :not(.stretch) { pointer-events: none; }
.wcard > :not(.stretch) :deep(.itip), .wbig :deep(.itip) { pointer-events: auto; }
.tgl { gap: 6px; }
.wm { width: 18px; flex: none; display: inline-flex; }
.wst { width: 14px; flex: none; display: inline-flex; justify-content: center; }
.wcard { flex-direction: row; align-items: center; gap: 12px; text-align: left; width: 100%; }
.wcard svg:not(.c3) { flex: 0 1 132px; min-width: 0; max-width: 132px; }
.wcard > .col { min-width: 0; }
.wcard .wsub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.numrow { align-items: center; }
.wcard > :not(.stretch) :deep(.accdot), .wbig :deep(.accdot) { pointer-events: auto; z-index: 2; }
.wcard:has(.stretch:active) { background: #202023; }
/* larger screens */
.wbig { cursor: pointer; gap: 14px; }
.wbig > :not(.stretch) { pointer-events: none; }
.wbig :deep(.chart), .wbig svg { pointer-events: none; }
.top { align-items: flex-start; }
.weekc { gap: 10px; }
.wrow { gap: 12px; min-height: 44px; border-radius: 8px; text-align: left; }
.wrow:disabled { cursor: default; }
.wl { width: 56px; flex: none; }
.barw { position: relative; min-width: 0; height: 10px; display: flex; align-items: center; }
.tgt { position: absolute; left: calc(100% / 1.2); top: 0; bottom: 0; width: 1px; background: var(--text-tertiary); }
.wk { width: 52px; text-align: right; flex: none; }
.demo-tag { padding: 1px 7px; border-radius: 6px; border: 1px dashed var(--text-tertiary); color: var(--text-tertiary); white-space: nowrap; }
.row.gap8 { gap: 8px; }
.overtag { padding: 2px 7px; border-radius: 6px; border: 1px dashed var(--text-secondary); color: var(--text-secondary); }
.hittag { padding: 2px 7px; border-radius: 6px; background: var(--color-surface-2); color: var(--text-primary); }
.prompt { flex-direction: row; align-items: center; gap: 12px; text-align: left; width: 100%; }
.pic { width: 36px; height: 36px; border-radius: 18px; background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; flex: none; }
.wempty { gap: 4px; padding: 28px 16px; border-radius: 12px; border: 1px dashed var(--color-border); align-items: center; text-align: center; }
.logc { --row-bg: var(--color-surface); gap: 4px; padding-top: 14px; }
.more { display: inline-flex; align-items: center; gap: 2px; text-decoration: none; }
.more:hover { color: #fff; }

.tablet .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.tablet .stack { gap: 16px; }
.tablet .c-c { grid-column: 1 / -1; }
.two .topbar, .three .topbar { flex-direction: row; align-items: flex-end; justify-content: space-between; }
.two .week, .three .week { gap: 6px; }
.two .grid { display: grid; grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); grid-template-areas: "a c" "b c"; gap: 20px; align-items: start; }
.two .c-a { grid-area: a; } .two .c-b { grid-area: b; } .two .c-c { grid-area: c; }
.three .grid { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr) minmax(380px, 1.25fr); gap: 20px; align-items: start; }
.two .stack, .three .stack { gap: 20px; }
/* Dynamic Type: the week strip keeps its 7 fixed columns; day letters/numbers cap (each day's full label is in its button) */
.day .t-cap { font-size: min(0.6471rem, 15px); line-height: 1.2; }
.circle.t-bodys { font-size: min(0.8824rem, 20px); line-height: 1; }
</style>
