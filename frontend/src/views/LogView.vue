<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import ManualTag from "../components/ManualTag.vue";
import Timeline from "../components/Timeline.vue";
import WeekStrip from "../components/WeekStrip.vue";
import {
  clampLogDate,
  dayTotalText,
  fastingHint,
  fastingLabel,
  nextFasting,
  shiftLogDate,
  summaryCells,
  targetLine,
} from "../lib/dayLog";
import { shortDate, todayInZone } from "../lib/dates";
import { isManualTarget } from "../lib/manualTarget";
import { vp } from "../lib/viewport";
import { deviceTimeZone } from "../state/profile";
import { loadDay, pendingFor, setFasting, totalsOf, viewed } from "../state/log";

const route = useRoute();
const router = useRouter();
const saving = ref(false);

const today = computed(() => viewed.today || todayInZone(deviceTimeZone()));
const setup = computed(() => viewed.setupDate);
const requested = computed(() => {
  const raw = typeof route.params.date === "string" ? route.params.date : today.value;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today.value;
});
const date = computed(() => clampLogDate(requested.value, today.value, setup.value));
const ready = computed(() => viewed.loaded);
const shown = computed(() => (viewed.loaded && viewed.date ? viewed.date : date.value));
const entries = computed(() => (ready.value ? viewed.entries : []));
const pending = computed(() => pendingFor(shown.value));
const totals = computed(() => totalsOf(entries.value));
const target = computed(() => (ready.value ? viewed.target : null));
const cells = computed(() => summaryCells(totals.value, target.value));
const line = computed(() => (ready.value ? targetLine(viewed.target, viewed.firstTargetDate) : ""));
const manual = computed(() => ready.value && isManualTarget(viewed.target?.reasons));
const totalLine = computed(() => dayTotalText(totals.value.kcal, entries.value.length));
const canPrev = computed(() => shiftLogDate(date.value, -1, today.value, setup.value) !== null);
const canNext = computed(() => shiftLogDate(date.value, 1, today.value, setup.value) !== null);

watch(date, (value) => {
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
async function onFasting(event: Event) {
  const input = event.target as HTMLInputElement;
  const next = nextFasting(input.checked);
  input.checked = viewed.fasting;
  if (saving.value) return;
  saving.value = true;
  await setFasting(date.value, next);
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
    <div v-else class="body" :class="{ desk: vp.desktop, stale: viewed.dim }" data-day-cards>
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
        <Timeline :date="shown" :today="today" :entries="entries" :pending="pending" show-empty />
      </div>
      <label class="done row">
        <input :checked="viewed.fasting" type="checkbox" :disabled="saving" aria-describedby="fast-hint" @change="onFasting" />
        <span class="col">
          <span class="t-bodys">{{ fastingLabel }}</span>
          <span id="fast-hint" class="t-capn c2">{{ fastingHint }}</span>
        </span>
      </label>
    </div>
  </main>
</template>

<style scoped>
.log { gap: 8px; min-width: 0; }
.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.body.stale { opacity: 0.55; }
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
.done input { width: 22px; height: 22px; margin: 1px 0 0; accent-color: var(--color-action); flex: none; }
.ask { gap: 12px; padding: 14px; border-radius: var(--radius-card); border: 1px solid var(--color-border); background: var(--color-surface); }
.askb { gap: 8px; }
</style>
