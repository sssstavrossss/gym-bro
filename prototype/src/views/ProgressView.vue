<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import Bar from "../components/Bar.vue";
import CircleBtn from "../components/CircleBtn.vue";
import WeightChart from "../components/WeightChart.vue";
import Skeleton from "../components/Skeleton.vue";
import Icon from "../components/Icon.vue";
import ManualTag from "../components/ManualTag.vue";
import { vp } from "../lib/viewport";
import { addDays, addMonths, daysInMonth, monthKey, monthName, parse, range, spanLabel, weekStart } from "../lib/dates";
import { int, signed } from "../lib/format";
import { avgIntake, dayTotals, hasLog, hasWeights, isManual, isOver, shadeFor, state, targetFor, today, trend } from "../store";
import { openFood, openWeight, ui } from "../ui";

const route = useRoute();
const router = useRouter();
const month = computed(() => {
  const m = route.params.month as string | undefined;
  return m && /^\d{4}-\d{2}$/.test(m) && m <= monthKey(today) ? m : monthKey(today);
});
const goMonth = (n: number) => router.replace(`/progress/${addMonths(month.value, n)}`);

const cells = computed(() => {
  const first = `${month.value}-01`;
  const lead = (parse(first).getDay() + 6) % 7;
  const n = daysInMonth(month.value);
  const out: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= n; d++) out.push(`${month.value}-${String(d).padStart(2, "0")}`);
  while (out.length % 7) out.push(null);
  return Array.from({ length: out.length / 7 }, (_, r) => out.slice(r * 7, r * 7 + 7));
});
function cellLabel(d0: string) {
  const tg = targetFor(d0);
  // read after the visible day number (and kcal on larger screens): " October, 1,822 kcal of 2,218, on target"
  const d = ` ${monthName(d0.slice(0, 7)).split(" ")[0]}`;
  const kc = vp.tablet && hasLog(d0) ? " kcal" : ` ${int(dayTotals(d0).kcal)} kcal`;
  if (d0 > today) return `${d}, future`;
  if (!hasLog(d0)) return `${d}, no log${tg ? "" : ", no target"}`;
  if (!tg) return `${d},${kc}, no target on this day`;
  const sh = shadeFor(d0);
  const st = sh === "on" ? "on target" : isOver(d0) ? "over target" : sh === "close" ? "within 10 %" : sh === "off" ? "within 20 %" : "more than 20 % off";
  return `${d},${kc} of ${int(tg.kcal)}${isManual(d0) ? " (manual target)" : ""}, ${st}`;
}
function cellClass(d: string) {
  if (d > today) return "future";
  if (d === today) return "today";
  return "s-" + shadeFor(d) + (isOver(d) ? " over" : "");
}
const anyLog = computed(() => state.entries.length > 0);
const loading = computed(() => ui.demo === "loading");
const open = (d: string) => d <= today && router.push(`/log/${d}`);

const summary = computed(() => {
  const start = `${month.value}-01`;
  const end = `${month.value}-${String(daysInMonth(month.value)).padStart(2, "0")}`;
  const lastPast = end < today ? end : addDays(today, -1);
  const days = start <= lastPast ? range(start, lastPast) : [];
  const logged = days.filter(hasLog);
  // S1: days before the first target are not counted in on-target stats
  const judged = logged.filter((d) => targetFor(d));
  const on = judged.filter((d) => shadeFor(d) === "on").length;
  const wEnd = trend(end < today ? end : today);
  const wStart = trend(addDays(start, -1));
  return { on, logged: judged.length, noTarget: logged.length - judged.length, manual: judged.filter(isManual).length, avg: avgIntake(days).avg, wDelta: wEnd != null && wStart != null ? wEnd - wStart : null };
});

/** Last 4 weeks (Mon–Sun), current week up to yesterday. */
const weeks = computed(() => {
  const y = addDays(today, -1);
  const ws = weekStart(y);
  return [3, 2, 1, 0].map((i) => {
    const a = addDays(ws, -7 * i);
    const b = i === 0 ? y : addDays(a, 6);
    const days = range(a, b);
    const { avg, days: n } = avgIntake(days);
    // compare with the average of each logged day's own target
    const logged = days.filter((d) => hasLog(d) && targetFor(d));
    const tg = logged.length ? logged.reduce((s2, d) => s2 + targetFor(d)!.kcal, 0) / logged.length : targetFor(b)?.kcal ?? null;
    const dev = tg ? avg / tg - 1 : 0;
    return { label: spanLabel(a, b), avg, n, of: days.length, tg, manual: logged.some(isManual), hit: !!tg && n > 0 && Math.abs(dev) <= 0.05, over: !!tg && n > 0 && dev > 0.05 };
  });
});
const chartEnd = computed(() => { const e = `${month.value}-${String(daysInMonth(month.value)).padStart(2, "0")}`; return e < today ? e : today; });
</script>

<template>
  <main class="screen">
    <header class="screen-head">
      <h1 class="t-title">Progress</h1>
      <span class="grow" />
      <div class="row nav">
        <CircleBtn icon="left" :size="28" label="Previous month" @click="goMonth(-1)" />
        <span class="t-bodys navlbl">{{ monthName(month) }}</span>
        <CircleBtn icon="right" :size="28" label="Next month" :disabled="month >= monthKey(today)" @click="goMonth(1)" />
      </div>
    </header>

    <div v-if="loading" class="pgrid" :class="{ desk: vp.desktop, tab: vp.tablet && !vp.desktop }">
      <section class="card cal" aria-busy="true"><div v-for="i in 5" :key="i" class="row wk"><Skeleton v-for="j in 7" :key="j" :h="vp.desktop ? 76 : 44" :r="10" /></div></section>
      <section class="card" style="gap: 12px"><Skeleton w="50%" /><Skeleton /><Skeleton /><Skeleton /></section>
    </div>
    <div v-else class="pgrid" :class="{ desk: vp.desktop, tab: vp.tablet && !vp.desktop }">
    <div class="pcol">
    <section class="card cal">
      <div class="row wk">
        <span v-for="(l, i) in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="i" class="t-cap c3 cellh">{{ l }}</span>
      </div>
      <div v-for="(r, i) in cells" :key="i" class="row wk">
        <template v-for="(d, j) in r" :key="j">
          <span v-if="!d" class="cell empty" />
          <button v-else type="button" class="cell" :class="cellClass(d)" :disabled="d > today"
            @click="open(d)">
            <span :class="d === today ? 't-bodys' : 't-label'">{{ Number(d.slice(8)) }}</span>
            <span v-if="vp.tablet && hasLog(d)" class="ck t-capn">{{ int(dayTotals(d).kcal) }}</span>
            <span class="sr-only">{{ cellLabel(d) }}</span>
            <span v-if="isOver(d)" class="ovm" aria-hidden="true" />
            <Icon v-else-if="d < today && shadeFor(d) === 'on'" name="check" :size="10" :sw="3.4" class="onm" aria-hidden="true" />
            <span v-else-if="d < today && shadeFor(d) === 'notarget'" class="ntm" aria-hidden="true">–</span>
          </button>
        </template>
      </div>
      <div class="row legend">
        <span class="row sw"><i class="s-on"><Icon name="check" :size="8" :sw="4" /></i> <span class="t-capn c2">±5%</span></span>
        <span class="row sw"><i class="s-close" /> <span class="t-capn c2">±10%</span></span>
        <span class="row sw"><i class="s-off" /> <span class="t-capn c2">±20%</span></span>
        <span class="row sw"><i class="s-far" /> <span class="t-capn c2">&gt;20%</span></span>
        <span class="row sw"><i class="s-off over" /> <span class="t-capn c2">over</span></span>
        <span class="row sw"><i class="s-none" /> <span class="t-capn c2">no log</span></span>
        <span class="row sw"><i class="s-notarget" /> <span class="t-capn c2">no target</span></span>
      </div>
    </section>
    <button v-if="!anyLog" type="button" class="card prompt row" @click="openFood()">
      <Icon name="cal" :size="20" class="c2" />
      <span class="col grow"><span class="t-bodys">Your month fills in as you log</span><span class="t-capn c2">Each logged day is shaded against that day's target.</span></span>
      <span class="chip t-label">Add food</span>
    </button>
    <p class="t-capn c2 m0">Shade = how close that day’s calories were to that day’s own target; ✓ = on target, hatched + corner = over, – = before your first target. {{ vp.hover ? "Click" : "Tap" }} a day to open its log.</p>
    </div>
    <div class="pcol">

    <section class="card row msum">
      <div class="col grow"><span class="t-capm c2">On target</span><span class="base"><span class="t-ns">{{ summary.on }}</span><span class="t-label c2">/ {{ summary.logged }} days</span></span><span v-if="summary.manual" class="row g4"><ManualTag /><span class="t-capn c2">{{ summary.manual }} day{{ summary.manual === 1 ? "" : "s" }}</span></span><span v-if="summary.noTarget" class="t-capn c2">{{ summary.noTarget }} day{{ summary.noTarget === 1 ? "" : "s" }} without target not counted</span></div>
      <div class="col grow"><span class="t-capm c2">Avg intake</span><span class="base"><span class="t-ns">{{ summary.logged ? int(summary.avg) : "–" }}</span><span class="t-label c2">kcal</span></span></div>
      <div class="col grow"><span class="t-capm c2">Weight</span><span class="base"><span class="t-ns">{{ summary.wDelta == null ? "–" : signed(summary.wDelta) }}</span><span class="t-label c2">kg</span></span></div>
    </section>

    <section class="card">
      <div class="row"><span class="t-cap c3">Weekly average</span><span class="grow" /><span class="t-capn c3">logged days only</span></div>
      <div v-for="w in weeks" :key="w.label" class="row wrow" :title="w.tg ? `Target average ${int(w.tg)} kcal` : 'No target'">
        <span class="col wl"><span class="t-label c2">{{ w.label }}</span><span class="t-capn c2">{{ w.n }} of {{ w.of }} days</span></span>
        <Bar v-if="w.tg" :pct="w.avg / (w.tg * 1.2)" :hit="w.hit" :over="w.over" :width="110" :aria-label="`${w.label}: average ${int(w.avg)} of ${int(w.tg)} kcal${w.hit ? ', on target' : w.over ? ', over' : ''}`" />
        <span v-else class="t-capn c2" style="width: 110px">no target</span>
        <span class="wm"><ManualTag v-if="w.manual" short /></span>
        <span class="wst" aria-hidden="true"><Icon v-if="w.hit" name="check" :size="12" :sw="3" /><span v-else-if="w.over" class="t-capn c2">+</span></span>
        <span class="grow" />
        <span class="t-bodys">{{ w.n ? int(w.avg) : "–" }}</span><span class="t-label c3">kcal</span>
      </div>
    </section>
    <section v-if="vp.tablet" class="card">
      <div class="row"><span class="t-cap c3">Weight · last 30 days</span><span class="grow" /><span class="t-capn c3">dots = weigh-ins · line = trend</span></div>
      <WeightChart v-if="hasWeights" :end="chartEnd" fluid :height="150" />
      <button v-else type="button" class="wempty col" @click="openWeight()"><span class="t-label c2">No weigh-ins yet</span><span class="t-capn c3">Log your weight to see the chart and trend.</span></button>
    </section>
    </div>
    </div>
  </main>
</template>

<style scoped>
.nav { gap: 6px; }
.navlbl { min-width: 104px; text-align: center; white-space: nowrap; }
/* 200 % text: the month switcher drops under the title instead of clipping */
.screen-head { flex-wrap: wrap; row-gap: 4px; }
.msum .base { flex-wrap: wrap; }
.msum > .col { min-width: 0; }
.m0 { margin: 0; }
.cal { gap: 6px; padding: 16px 12px; }
.wk { gap: 4px; } /* 7 × 44 pt cells fit a 393 pt phone */
.cellh { flex: 1 1 0; text-align: center; }
.cell { flex: 1 1 0; min-height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--text-primary); min-width: 0; }
.cell.empty { visibility: hidden; }
.cell.future { color: var(--text-tertiary); cursor: default; }
.cell.today { box-shadow: inset 0 0 0 2px var(--color-action); }
.cell:not(.future):active { opacity: .7; }
.s-on { background: var(--shade-on-target); color: var(--color-on-action) !important; }
.s-close { background: var(--shade-close); color: var(--color-on-action) !important; }
.s-off { background: var(--shade-off); }
.s-far { background: var(--shade-far); }
.cell.s-notarget { background: transparent; color: var(--text-secondary); box-shadow: inset 0 0 0 1px var(--text-tertiary); }
.ntm { position: absolute; top: 1px; right: 5px; font-size: 0.7059rem; line-height: 1; color: var(--text-secondary); }
.onm { position: absolute; top: 4px; right: 4px; }
.sw i.s-notarget { box-shadow: inset 0 0 0 1px var(--text-tertiary); }
.sw i.s-on { display: inline-flex; align-items: center; justify-content: center; color: var(--color-on-action); }
.g4 { gap: 4px; margin-top: 2px; }
.wm { width: 18px; flex: none; display: inline-flex; }
.wst { width: 14px; flex: none; display: inline-flex; justify-content: center; }
.cell.s-none { outline: 1px dashed var(--color-border); outline-offset: -1px; }
.legend { justify-content: space-between; padding-top: 8px; flex-wrap: wrap; row-gap: 6px; }
/* over: diagonal hatch on top of the shade (not by lightness alone) */
.cell.over, .sw i.over { background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.28) 0 2px, transparent 2px 6px); }
.cell { position: relative; }
.ovm { position: absolute; top: 4px; right: 4px; width: 0; height: 0; border-left: 7px solid transparent; border-top: 7px solid var(--text-secondary); }
.prompt { flex-direction: row; align-items: center; gap: 12px; text-align: left; width: 100%; }
.wempty { gap: 4px; padding: 28px 16px; border-radius: 12px; border: 1px dashed var(--color-border); align-items: center; text-align: center; width: 100%; }
.pgrid, .pcol { display: flex; flex-direction: column; gap: var(--space-gap); }
.ck { font-variant-numeric: tabular-nums; }
.tab .cell, .desk .cell { flex-direction: column; gap: 2px; min-height: 60px; }
.tab .pcol + .pcol { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.tab .pcol + .pcol > :last-child { grid-column: 1 / -1; }
.tab.pgrid { gap: 16px; }
.desk.pgrid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(340px, 1fr); gap: 24px; align-items: start; }
.desk .pcol { gap: 20px; }
.desk .cal { padding: 20px; gap: 8px; }
.desk .wk { gap: 8px; }
.desk .cell { min-height: 76px; align-items: flex-start; justify-content: space-between; padding: 8px 10px; border-radius: 12px; }
.desk .cell.empty { visibility: hidden; }
.desk .ck { font-size: 0.7059rem; }
.desk .cellh { padding-bottom: 4px; }
.sw { gap: 5px; }
.sw i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.sw i.s-none { border: 1px dashed var(--color-border); }
.msum { flex-direction: row; gap: 8px; align-items: flex-start; }
.msum .col { gap: 2px; }
.wrow { gap: 10px; }
.wl { width: 104px; flex: none; gap: 1px; }
/* 200 % text: the bar gives way so the kcal value is never clipped */
.wrow { min-width: 0; }
.wrow :deep(.bar), .wrow > svg { flex: 0 1 110px; min-width: 24px; }
.wrow > .t-bodys { white-space: nowrap; }
.wrow .t-label.c3 { margin-left: -6px; }
/* Dynamic Type: calendar cells stay a fixed grid; weekday letters and day numbers cap (full text in each cell's label) */
.cellh { font-size: min(0.6471rem, 15px) !important; }
.cell .t-label, .cell .t-bodys { font-size: min(0.8824rem, 19px); line-height: 1.1; }
</style>
