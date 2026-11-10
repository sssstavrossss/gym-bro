<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import ManualTag from "../components/ManualTag.vue";
import Timeline from "../components/Timeline.vue";
import WeekStrip from "../components/WeekStrip.vue";
import {
  clampLogDate,
  dayCompleteHint,
  dayCompleteLabel,
  dayTotalText,
  fastingChoice,
  fastingQuestion,
  planDayComplete,
  shiftLogDate,
  summaryCells,
  targetLine,
} from "../lib/dayLog";
import { shortDate, todayInZone } from "../lib/dates";
import { isManualTarget } from "../lib/manualTarget";
import { vp } from "../lib/viewport";
import { deviceTimeZone } from "../state/profile";
import { loadDay, pendingFor, setDayComplete, totalsOf, viewed } from "../state/log";

const route = useRoute();
const router = useRouter();
const askFast = ref(false);
const saving = ref(false);

const today = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const setup = computed(() => viewed.setupDate);
const requested = computed(() => {
  const raw = typeof route.params.date === "string" ? route.params.date : today.value;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today.value;
});
const date = computed(() => clampLogDate(requested.value, today.value, setup.value));
const ready = computed(() => viewed.loaded && viewed.date === date.value && !viewed.loading);
const entries = computed(() => (ready.value ? viewed.entries : []));
const pending = computed(() => pendingFor(date.value));
const totals = computed(() => totalsOf(entries.value));
const target = computed(() => (ready.value ? viewed.target : null));
const cells = computed(() => summaryCells(totals.value, target.value));
const line = computed(() => (ready.value ? targetLine(viewed.target, viewed.firstTargetDate) : ""));
const manual = computed(() => ready.value && isManualTarget(viewed.target?.reasons));
const totalLine = computed(() => dayTotalText(totals.value.kcal, entries.value.length));
const canPrev = computed(() => shiftLogDate(date.value, -1, today.value, setup.value) !== null);
const canNext = computed(() => shiftLogDate(date.value, 1, today.value, setup.value) !== null);

watch(date, (value) => {
  askFast.value = false;
  if (typeof route.params.date === "string" && route.params.date !== value) {
    void router.replace(`/log/${value}`);
    return;
  }
  if (viewed.date === value && viewed.loaded && !viewed.loading) return;
  void loadDay(value);
}, { immediate: true });

function go(by: number) {
  const next = shiftLogDate(date.value, by, today.value, setup.value);
  if (!next) return;
  void router.push(next === today.value ? "/log" : `/log/${next}`);
}
function pick(day: string) {
  if (day === date.value) return;
  void router.push(day === today.value ? "/log" : `/log/${day}`);
}
async function onComplete(event: Event) {
  const input = event.target as HTMLInputElement;
  const next = input.checked;
  input.checked = viewed.complete;
  if (saving.value) return;
  const plan = planDayComplete(next, entries.value.length);
  if (plan.kind === "ask") {
    askFast.value = true;
    return;
  }
  saving.value = true;
  await setDayComplete(date.value, plan.kind === "save", false);
  saving.value = false;
}
function declineFast() {
  askFast.value = false;
}
async function confirmFast() {
  const choice = fastingChoice(true);
  askFast.value = false;
  if (!choice.save) return;
  saving.value = true;
  await setDayComplete(date.value, choice.complete, choice.fasting);
  saving.value = false;
}
</script>

<template>
  <main class="screen log">
    <header class="screen-head">
      <h1 class="t-title">Log</h1>
      <span class="grow" />
      <div class="row nav">
        <button type="button" class="cbtn" aria-label="Previous day" :disabled="!canPrev" @click="go(-1)">
          <Icon name="left" :size="18" />
        </button>
        <span class="t-bodys navlbl">{{ shortDate(date) }}</span>
        <button type="button" class="cbtn" aria-label="Next day" :disabled="!canNext" @click="go(1)">
          <Icon name="right" :size="18" />
        </button>
      </div>
    </header>

    <WeekStrip :anchor="date" :selected="date" :today="today" :setup-date="setup" :logged-dates="viewed.loggedDates" @select="pick" />

    <p v-if="!ready" class="t-label c2" role="status">Loading this day…</p>
    <div v-else class="body" :class="{ desk: vp.desktop }">
      <section class="summary" :aria-label="target ? 'Day total against that day\'s target' : 'Day total, no target'">
        <div v-for="cell in cells" :key="cell.key" class="col">
          <span class="t-ns" :class="{ overv: cell.over }" data-num>{{ cell.value }}<span v-if="cell.over" class="sr-only"> over</span></span>
          <span class="t-capn c3">{{ cell.caption }}</span>
        </div>
      </section>
      <p class="t-capn c2 tline row" :class="{ notg: !target }">{{ line }}<ManualTag v-if="manual" /></p>
      <div class="maincol">
        <div class="row dayline">
          <span class="t-bodys">Day total</span>
          <span class="t-body c2">&nbsp;· {{ totalLine }}</span>
        </div>
        <Timeline :date="date" :today="today" :entries="entries" :pending="pending" show-empty />
      </div>
      <label class="done row">
        <input :checked="viewed.complete" type="checkbox" :disabled="saving" :aria-describedby="askFast ? 'fast-q' : 'done-hint'" @change="onComplete" />
        <span class="col">
          <span class="t-bodys">{{ dayCompleteLabel }}</span>
          <span id="done-hint" class="t-capn c2">{{ dayCompleteHint }}</span>
        </span>
      </label>
      <div v-if="askFast" class="ask col" role="alertdialog" aria-labelledby="fast-q">
        <p id="fast-q" class="t-bodys">{{ fastingQuestion }}</p>
        <div class="row askb">
          <button type="button" class="chip t-label" @click="declineFast">No</button>
          <button type="button" class="chip on t-label" @click="confirmFast">Yes</button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.log { gap: 8px; min-width: 0; }
.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.summary { display: flex; flex-direction: row; justify-content: space-between; }
.maincol { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.desk.body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); column-gap: 32px; row-gap: 12px; align-items: start; }
.desk .maincol { grid-column: 1; grid-row: 1 / span 4; }
.desk .summary, .desk .tline, .desk .done, .desk .ask { grid-column: 2; }
.desk .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.nav { gap: 6px; }
.nav .cbtn:disabled { opacity: 1; color: var(--text-tertiary); }
.navlbl { min-width: 108px; text-align: center; }
.summary { padding: 12px 16px; border-radius: var(--radius-card); background: var(--color-surface); min-width: 0; }
.is-tablet .summary { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; }
.overv { text-decoration: underline dashed var(--text-secondary); text-underline-offset: 4px; }
.tline { margin: 0; padding: 0 4px; }
.tline.notg { padding: 8px 12px; border: 1px dashed var(--color-border-strong); border-radius: 10px; }
.dayline { min-height: 44px; gap: 0; padding-top: 4px; }
.done { gap: 12px; padding: 12px 14px; border-radius: var(--radius-card); background: var(--color-surface); cursor: pointer; align-items: flex-start; }
.done input { width: 22px; height: 22px; margin: 1px 0 0; accent-color: #fff; flex: none; }
.ask { gap: 12px; padding: 14px; border-radius: var(--radius-card); border: 1px solid var(--color-border); background: var(--color-surface); }
.askb { gap: 8px; }
</style>
