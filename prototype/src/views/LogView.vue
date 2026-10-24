<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import CircleBtn from "../components/CircleBtn.vue";
import Timeline from "../components/Timeline.vue";
import MacroBars from "../components/MacroBars.vue";
import Icon from "../components/Icon.vue";
import Skeleton from "../components/Skeleton.vue";
import ManualTag from "../components/ManualTag.vue";
import { addDays, dayMonth, longDate, shortDate } from "../lib/dates";
import { int } from "../lib/format";
import { vp } from "../lib/viewport";
import { dayTotals, entriesFor, firstTargetDate, isManual, macroStatus, reasonText, setComplete, state, targetFor, targetRowFor, today } from "../store";
import { openFood, startSelect, ui } from "../ui";

const route = useRoute();
const router = useRouter();
const date = computed(() => {
  const d = route.params.date as string | undefined;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
});
const go = (n: number) => router.replace(`/log/${addDays(date.value, n)}`);
const t = computed(() => dayTotals(date.value));
const g = computed(() => targetFor(date.value));
const n = computed(() => entriesFor(date.value).length);
const left = computed(() => (g.value ? g.value.kcal - t.value.kcal : 0));
const summary = computed(() => {
  const tg = g.value;
  const lbl = (v: number, u: string) => (tg ? `/ ${int(v)} ${u}` : u === "kcal" ? "kcal" : u);
  return [
    ["kcal", int(t.value.kcal), lbl(tg?.kcal ?? 0, "kcal"), t.value.kcal, tg?.kcal ?? 0],
    ["p", int(t.value.p), lbl(tg?.p ?? 0, "P"), t.value.p, tg?.p ?? 0],
    ["f", int(t.value.f), lbl(tg?.f ?? 0, "F"), t.value.f, tg?.f ?? 0],
    ["c", int(t.value.c), lbl(tg?.c ?? 0, "C"), t.value.c, tg?.c ?? 0],
  ] as const;
});
/** "Target 2,151 kcal · since 8 Oct · Goal change" — or why there is none (S1). */
const targetLine = computed(() => {
  const r = targetRowFor(date.value);
  if (!r) return firstTargetDate.value ? `No target on this day · targets start ${dayMonth(firstTargetDate.value)}` : "No target on this day";
  return `Target ${int(r.kcal)} kcal · since ${dayMonth(r.date)} · ${reasonText(r)}`;
});
const complete = computed({ get: () => !!state.complete[date.value], set: (v: boolean) => setComplete(date.value, v) });
const loading = computed(() => ui.demo === "loading");
</script>

<template>
  <main class="screen log">
    <header class="screen-head">
      <div class="col">
        <span v-if="vp.desktop" class="t-cap c2">{{ longDate(date) }}</span>
        <h1 class="t-title">Log</h1>
      </div>
      <span class="grow" />
      <div class="row nav">
        <CircleBtn icon="left" :size="vp.desktop ? 32 : 28" label="Previous day" @click="go(-1)" />
        <span class="t-bodys navlbl">{{ shortDate(date) }}</span>
        <CircleBtn icon="right" :size="vp.desktop ? 32 : 28" label="Next day" :disabled="date >= today" @click="go(1)" />
        <button v-if="vp.desktop && date !== today" type="button" class="chip t-label" @click="router.replace('/log')">Today</button>
      </div>
    </header>

    <!-- Loading demo -->
    <template v-if="loading">
      <section class="summary row"><div v-for="i in 4" :key="i" class="col" style="gap: 6px"><Skeleton w="44px" :h="16" /><Skeleton w="56px" :h="10" /></div></section>
      <div class="col skl"><div v-for="i in 6" :key="i" class="row" style="gap: 12px; height: 44px"><Skeleton w="40px" /><Skeleton w="8px" :h="8" :r="4" /><Skeleton w="45%" /><span class="grow" /><Skeleton w="34px" /></div></div>
    </template>

    <!-- Desktop: timeline on the left, sticky day summary on the right -->
    <div v-else-if="vp.desktop" class="dash log-dash">
      <div class="col" style="gap: 8px">
        <div class="row dayline">
          <span class="t-bodys">Day total</span><span class="t-body c2">&nbsp;· {{ int(t.kcal) }} kcal · {{ n }} item{{ n === 1 ? "" : "s" }}</span><span class="grow" />
          <button v-if="n && !ui.selecting" type="button" class="chip t-label" @click="startSelect()">Select</button>
        </div>
        <Timeline :date="date" />
      </div>
      <aside class="stack sticky">
        <section class="card hero">
          <span class="t-cap c2">{{ date === today && g ? (left >= 0 ? "Left today" : "Over today") : "Day total" }}</span>
          <span class="t-capn c2 tline row tl2">{{ targetLine }}<ManualTag v-if="isManual(date)" /></span>
          <div class="row end">
            <div class="col">
              <span class="t-dl num">{{ int(date === today ? Math.abs(left) : t.kcal) }}</span>
              <span class="t-label c2">{{ !g ? "kcal · no target on this day" : date === today ? (left >= 0 ? "kcal left" : "kcal over") : `kcal · that day's target ${int(g.kcal)}` }}</span>
            </div>
          </div>
        </section>
        <MacroBars :date="date" />
        <button type="button" class="primary-btn t-bodys addbtn" @click="openFood({ date })">
          <Icon name="plus" :size="18" :sw="2.6" /> Add food <kbd class="k">N</kbd>
        </button>
        <label class="done row"><input v-model="complete" type="checkbox" /><span class="col"><span class="t-bodys">Day complete</span><span class="t-capn c2">Everything eaten is logged. Unmarked days count as missing, never as zero.</span></span></label>
        <p class="t-capn c3 tip">Hover a food for Copy to… / Delete · click to edit amount or time · click the circle, Ctrl/⌘-click or Shift-click to select several</p>
      </aside>
    </div>

    <!-- Phone / tablet -->
    <template v-else>
      <section class="summary row">
        <div v-for="[k, a, b, cur, tgt] in summary" :key="b" class="col">
          <span class="t-ns" :class="{ overv: g && macroStatus(k, cur, tgt) === 'over' }">{{ a }}<span v-if="g && macroStatus(k, cur, tgt) === 'over'" class="sr-only"> over</span></span><span class="t-capn c3">{{ b }}</span>
        </div>
      </section>
      <p class="t-capn c2 tline row tl2" :class="{ notg: !g }">{{ targetLine }}<ManualTag v-if="isManual(date)" /></p>
      <div class="row dayline">
        <span class="t-bodys">Day total</span><span class="t-body c2">&nbsp;· {{ int(t.kcal) }} kcal · {{ n }} item{{ n === 1 ? "" : "s" }}</span><span class="grow" />
        <button v-if="n && !ui.selecting" type="button" class="chip t-label" @click="startSelect()">Select</button>
      </div>
      <Timeline :date="date" />
      <label v-if="n" class="done row"><input v-model="complete" type="checkbox" /><span class="col"><span class="t-bodys">Day complete</span><span class="t-capn c2">Unmarked days count as missing in Progress, never as zero.</span></span></label>
      <p v-if="n" class="t-capn c3 tip">{{ vp.hover ? "Hover a food for Copy to… / Delete · click the circle to select several" : "Swipe left for Copy to… / Delete · hold a food to select several · tap to edit amount or time" }}</p>
    </template>
  </main>
</template>

<style scoped>
.log { gap: 8px; }
.nav { gap: 6px; }
.navlbl { min-width: 84px; text-align: center; }
.summary { justify-content: space-between; padding: 12px 16px; border-radius: var(--radius-card); background: var(--color-surface); }
/* over target: neutral dashed underline, never red */
.overv { text-decoration: underline dashed var(--text-secondary); text-underline-offset: 4px; }
.tline { margin: 0; padding: 0 4px; }
.tl2 { gap: 6px; flex-wrap: wrap; }
.tline.notg { padding: 8px 12px; border: 1px dashed var(--color-border-strong, #4a4a52); border-radius: 10px; }
.dayline { min-height: 44px; gap: 0; padding-top: 4px; }
.tip { text-align: center; margin: 8px 0 0; }
.log-dash { grid-template-columns: minmax(0, 1fr) 340px; gap: 40px; margin-top: 8px; }
.hero { gap: 6px; padding: 20px; }
.end { align-items: flex-end; }
.addbtn { gap: 8px; }
.addbtn .k { color: var(--color-on-action); border-color: rgba(0,0,0,.25); }
.done { gap: 12px; padding: 12px 14px; border-radius: var(--radius-card); background: var(--color-surface); cursor: pointer; align-items: flex-start; margin-top: 8px; }
.done input { width: 20px; height: 20px; margin: 1px 0 0; accent-color: #fff; flex: none; }
.skl { gap: 0; }
.is-desktop .log { gap: 16px; }
.is-desktop .navlbl { min-width: 100px; }
.is-desktop .tip { text-align: left; margin: 0; line-height: 1.5; }
.is-desktop .done { margin-top: 0; }
</style>
