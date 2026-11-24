<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import BurnCard from "./BurnCard.vue";
import Icon from "./Icon.vue";
import LowDaysCard from "./LowDaysCard.vue";
import RecalcCalendar from "./RecalcCalendar.vue";
import { declineRecalculate, getRecalculate, previewRecalculate, saveRecalculate, type RecalculateCalendarDay, type RecalculateReview } from "../api";
import { dayMonth, spanLabel } from "../lib/dates";
import { int } from "../lib/format";
import { periodLabel, targetLine } from "../lib/recalculate";
import { loadToday } from "../state/log";
import { loadProfile, profile } from "../state/profile";
import { weightUnit, wt } from "../state/units";
import { closeSheet, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "recalculate");
const review = ref<RecalculateReview | null>(null);
const excluded = ref<string[]>([]);
const includeZero = ref<string[]>([]);
/** Low days count by default, but the sheet asks before it accepts. Tapping one in the calendar answers too. */
const lowAnswered = ref(false);
const selected = ref("");
const busy = ref(false);
const error = ref("");

const current = computed(() => profile.targets);
const proposed = computed(() => review.value?.proposed ?? null);
const lowDays = computed(() => review.value?.lowDays ?? []);
const needsAnswer = computed(() => lowDays.value.length > 0 && !lowAnswered.value);
/** The formula is offered only when it would give a different burn. */
const formulaDiffers = computed(() => !!review.value && review.value.burn !== review.value.formula.tdee);

const period = computed(() => {
  const value = review.value;
  if (!value) return "";
  if (value.periodDays === 0) return "No finished day since your last update. Today is not included.";
  if (value.capped) {
    const last = value.lastUpdate ? `your last update was ${dayMonth(value.lastUpdate)}` : spanLabel(value.from, value.to);
    return `${periodLabel(value.periodDays, true)} · ${last}`;
  }
  const since = value.lastUpdate ? "since your last update" : "since you started";
  return `${spanLabel(value.from, value.to)} · ${periodLabel(value.periodDays, false)} ${since}`;
});
const derivation = computed(() => {
  const value = review.value;
  const saved = profile.saved;
  if (!value || !proposed.value || !saved) return "";
  const rate = saved.rateKgPerWeek ? `${Number(wt(saved.rateKgPerWeek, 2))} ${weightUnit()}` : "";
  return targetLine(value.burn, proposed.value.kcal, saved.goal, rate);
});
const note = computed(() => {
  const day = review.value?.calendar.find((item) => item.date === selected.value);
  if (!day) return "";
  if (day.kcal == null) return `${dayMonth(day.date)} · no log`;
  return `${dayMonth(day.date)} · ${int(day.kcal)} kcal`;
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  excluded.value = [];
  includeZero.value = [];
  lowAnswered.value = false;
  selected.value = "";
  error.value = "";
  void load(false);
});

async function load(preview: boolean) {
  busy.value = true;
  error.value = "";
  try {
    review.value = preview
      ? await previewRecalculate(excluded.value, includeZero.value)
      : await getRecalculate();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Couldn't load the review.";
  } finally {
    busy.value = false;
  }
}

function toggle(list: string[], date: string): string[] {
  return list.includes(date) ? list.filter((item) => item !== date) : [...list, date];
}

function pick(day: RecalculateCalendarDay) {
  selected.value = day.date;
  if (busy.value) return;
  if (day.status === "low") {
    excluded.value = toggle(excluded.value, day.date);
    lowAnswered.value = true;
    void load(true);
  } else if (day.status === "nolog") {
    includeZero.value = toggle(includeZero.value, day.date);
    void load(true);
  }
}

function answerLow(count: boolean) {
  excluded.value = count ? [] : lowDays.value.map((day) => day.date);
  lowAnswered.value = true;
  void load(true);
}

async function accept(mode: "adaptive" | "formula") {
  if (busy.value || !review.value || needsAnswer.value) return;
  busy.value = true;
  error.value = "";
  try {
    const saved = await saveRecalculate(excluded.value, includeZero.value, mode);
    await loadProfile();
    await loadToday();
    toast(saved.reason === "recalculation_formula"
      ? "Target set from the formula"
      : saved.reason === "recalculation_adaptive" ? "Target recalculated from your logs" : `Target saved · burn stays at ${int(saved.burn)} until it can be measured`);
    closeSheet();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Couldn't save the new target.";
  } finally {
    busy.value = false;
  }
}

async function decline() {
  if (busy.value) {
    closeSheet();
    return;
  }
  busy.value = true;
  try {
    await declineRecalculate(excluded.value, includeZero.value);
  } catch {
    // Closing still leaves the current target in place.
  } finally {
    busy.value = false;
    closeSheet();
  }
}

function delta(next: number | undefined, prev: number | undefined): string {
  if (next == null || prev == null) return "—";
  const diff = next - prev;
  if (diff === 0) return "0";
  return `${diff > 0 ? "+" : "−"}${int(Math.abs(diff))}`;
}
</script>

<template>
  <BottomSheet :open="open" label="Recalculate" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head recalc-title grow">Recalculate</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
      <p class="t-capn c2 saved">Nothing is saved until you accept.</p>
      <p v-if="period" class="t-body period recalc-period" data-recalc-period>{{ period }}</p>
    </template>
    <div class="col body">
      <p v-if="!review && busy" class="t-label c2">Loading the days since your last update…</p>
      <template v-else-if="review">
        <LowDaysCard
          v-if="lowDays.length"
          :days="lowDays"
          :answered="lowAnswered"
          :counted-kcal="review.countedKcal"
          :left-out-kcal="review.leftOutKcal"
          :busy="busy"
          @count="answerLow(true)"
          @leave="answerLow(false)"
          @change="lowAnswered = false"
        />
        <template v-if="review.calendar.length">
          <RecalcCalendar :days="review.calendar" :selected="selected" @pick="pick" />
          <p class="t-capn c2 explain">Tap a day to switch it. An empty day can be counted as 0.</p>
          <p v-if="note" class="t-body explain">{{ note }}</p>
          <p v-if="includeZero.length" class="t-capn c2 explain">An empty day is counted as 0 kcal. That is not a guess of what you ate.</p>
        </template>
        <BurnCard :review="review" />
        <div class="compare" data-recalc-preview>
          <span class="t-capn c2"></span>
          <span class="t-capn c2">Now</span>
          <span class="t-capn c2">New</span>
          <span class="t-capn c2">Change</span>
          <span class="t-label">kcal</span>
          <span class="t-label num">{{ current ? int(current.kcal) : "—" }}</span>
          <span class="t-label num">{{ proposed ? int(proposed.kcal) : "—" }}</span>
          <span class="t-label num">{{ delta(proposed?.kcal, current?.kcal) }}</span>
          <span class="t-label">P</span>
          <span class="t-label num">{{ current ? int(current.protein) : "—" }}</span>
          <span class="t-label num">{{ proposed ? int(proposed.protein) : "—" }}</span>
          <span class="t-label num">{{ delta(proposed?.protein, current?.protein) }}</span>
          <span class="t-label">F</span>
          <span class="t-label num">{{ current ? int(current.fat) : "—" }}</span>
          <span class="t-label num">{{ proposed ? int(proposed.fat) : "—" }}</span>
          <span class="t-label num">{{ delta(proposed?.fat, current?.fat) }}</span>
          <span class="t-label">C</span>
          <span class="t-label num">{{ current ? int(current.carbs) : "—" }}</span>
          <span class="t-label num">{{ proposed ? int(proposed.carbs) : "—" }}</span>
          <span class="t-label num">{{ delta(proposed?.carbs, current?.carbs) }}</span>
          <p v-if="proposed?.floorApplied" class="t-capn c2 span" data-derivation>Raised to your BMR so the target does not go below it.</p>
          <p v-else-if="derivation" class="t-capn c2 span" data-derivation>{{ derivation }}</p>
        </div>
        <p v-if="needsAnswer" class="t-capn c2 explain" data-answer-low>Answer the low days above to accept.</p>
        <button type="button" class="btn primary block t-bodys" :disabled="busy || needsAnswer" data-recalc-accept @click="accept('adaptive')">
          {{ proposed ? `Accept ${int(proposed.kcal)} kcal` : "Accept" }}
        </button>
        <button type="button" class="btn secondary block t-bodys recalc-decline" :disabled="busy" @click="decline">Decline</button>
        <button v-if="formulaDiffers" type="button" class="btn block t-label formula" :disabled="busy || needsAnswer" data-recalc-formula @click="accept('formula')">
          Use the formula instead · {{ int(review.formula.kcal) }} kcal
        </button>
      </template>
      <p v-if="error" class="t-body" role="alert">{{ error }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-m); align-items: center; }
.body { gap: var(--space-m); }
.explain, .saved, .period { margin: 0; }
.compare {
  display: grid; grid-template-columns: 1.1fr repeat(3, minmax(0, 1fr)); gap: var(--space-s) var(--space-m); align-items: baseline;
}
.compare .num { text-align: right; font-variant-numeric: tabular-nums; }
.span { grid-column: 1 / -1; margin: 0; }
/* A quiet text button: the formula is the fallback, not the suggestion. */
.formula { color: var(--text-secondary); }
.formula::before { background: transparent; box-shadow: none; }
</style>
<style>
html.dt-xl .recalc-period { display: none; }
html.dt-xl .recalc-title { font-size: 1.15rem; }
</style>
