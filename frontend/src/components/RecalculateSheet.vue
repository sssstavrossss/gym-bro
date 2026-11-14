<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import RecalcCalendar from "./RecalcCalendar.vue";
import { declineRecalculate, getRecalculate, previewRecalculate, saveRecalculate, type RecalculateCalendarDay, type RecalculateReview } from "../api";
import { dayMonth } from "../lib/dates";
import { int, kg } from "../lib/format";
import { loadToday } from "../state/log";
import { loadProfile, profile } from "../state/profile";
import { closeSheet, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "recalculate");
const review = ref<RecalculateReview | null>(null);
const excluded = ref<string[]>([]);
const includeZero = ref<string[]>([]);
const selected = ref("");
const busy = ref(false);
const error = ref("");

const current = computed(() => profile.targets);
const proposed = computed(() => {
  const value = review.value;
  if (!value) return null;
  return value.enough && value.proposed ? value.proposed : value.formula;
});
const acceptKcal = computed(() => proposed.value?.kcal ?? null);
const note = computed(() => {
  const day = review.value?.calendar.find((item) => item.date === selected.value);
  if (!day) return "";
  if (day.kcal == null) return `${dayMonth(day.date)} · no log`;
  return `${dayMonth(day.date)} · ${int(day.kcal)} kcal`;
});
const zeroWarning = computed(() => includeZero.value.length > 0);

watch(open, (isOpen) => {
  if (!isOpen) return;
  excluded.value = [];
  includeZero.value = [];
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

function pick(day: RecalculateCalendarDay) {
  selected.value = day.date;
  if (busy.value) return;
  if (day.status === "low") {
    excluded.value = excluded.value.includes(day.date)
      ? excluded.value.filter((item) => item !== day.date)
      : [...excluded.value, day.date];
    void load(true);
  } else if (day.status === "nolog") {
    includeZero.value = includeZero.value.includes(day.date)
      ? includeZero.value.filter((item) => item !== day.date)
      : [...includeZero.value, day.date];
    void load(true);
  }
}

function countAllLow() {
  excluded.value = [];
  void load(true);
}

function reset() {
  excluded.value = [];
  includeZero.value = [];
  void load(true);
}

async function accept() {
  if (busy.value || !review.value || acceptKcal.value == null) return;
  const mode = review.value.enough && review.value.proposed ? "adaptive" : "formula";
  busy.value = true;
  error.value = "";
  try {
    await saveRecalculate(excluded.value, includeZero.value, mode);
    await loadProfile();
    await loadToday();
    toast(mode === "formula" ? "Target recalculated from the formula." : "Target recalculated from your logs.");
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

function line(numbers: { kcal: number; protein: number; fat: number; carbs: number } | null): string {
  if (!numbers) return "—";
  return `${int(numbers.kcal)} kcal · P ${int(numbers.protein)} · F ${int(numbers.fat)} · C ${int(numbers.carbs)}`;
}
</script>

<template>
  <BottomSheet :open="open" label="Recalculate" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow recalc-title">Recalculate</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet">×</button>
      </div>
    </template>
    <div class="col body">
      <p v-if="!review && busy" class="t-label c2">Loading the days since your last recalculation…</p>
      <template v-else-if="review">
        <p v-if="review.periodDays > 0" class="t-body period recalc-period">
          {{ dayMonth(review.from) }} – {{ dayMonth(review.to) }}
        </p>
        <p v-else class="t-body period recalc-period">No finished day since the last recalculation. Today is not included.</p>
        <RecalcCalendar :days="review.calendar" :selected="selected" @pick="pick" />
        <div class="row chips">
          <button type="button" class="chip t-label" :disabled="busy" @click="countAllLow">Count all low</button>
          <button type="button" class="chip t-label" :disabled="busy" @click="reset">Reset</button>
        </div>
        <p v-if="note" class="t-body">{{ note }}</p>
        <p v-if="zeroWarning" class="t-capn c2">An empty day is counted as 0 kcal. That is not a guess of what you ate.</p>
        <section class="stats" aria-label="This preview">
          <span class="t-label">{{ review.includedDays }} days counted</span>
          <span v-if="review.averageKcal != null" class="t-label c2">avg {{ int(Math.round(review.averageKcal)) }} kcal</span>
          <span v-if="review.trendChangeKg != null" class="t-label c2">trend {{ kg(review.trendChangeKg) }} kg</span>
        </section>
        <div class="compare" data-recalc-preview>
          <p class="t-label c2">Now</p>
          <p class="t-bodys">{{ line(current) }}</p>
          <p class="t-label c2">{{ proposed?.manualKept ? "Estimated burn, your number kept" : "New" }}</p>
          <p class="t-bodys">{{ proposed ? line(proposed) : "—" }}</p>
          <p v-if="review.enough && review.burn != null" class="t-body" data-derivation>
            Adaptive. Estimated burn {{ int(Math.round(review.burn)) }} kcal is the average of the included days, adjusted for the trend change, then for your goal.
          </p>
          <p v-else class="t-body" data-derivation role="status">
            Formula fallback. {{ review.blocked }} This preview uses Mifflin-St Jeor times your activity. Nothing is guessed.
          </p>
          <p v-if="proposed?.floorApplied" class="t-capn">Raised to your BMR so the target does not go below it.</p>
        </div>
        <div class="row chips">
          <button type="button" class="chip t-label" :disabled="busy" @click="load(true)">Preview</button>
          <p class="t-capn c2 saved">Nothing is saved until you accept.</p>
        </div>
        <button type="button" class="primary-btn t-bodys" :disabled="busy || acceptKcal == null" @click="accept">
          {{ acceptKcal == null ? "Accept" : `Accept ${int(acceptKcal)} kcal` }}
        </button>
        <button type="button" class="chip t-label decline recalc-decline" :disabled="busy" @click="decline">Decline</button>
      </template>
      <p v-if="error" class="t-body" role="alert">{{ error }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-gap); align-items: center; }
.body { gap: var(--space-gap); }
.chips { gap: var(--space-gap); align-items: center; flex-wrap: wrap; }
.chip { min-height: var(--control-hit); }
.stats { display: flex; flex-wrap: wrap; gap: var(--space-gap); }
.compare { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); }
.compare p, .saved { margin: 0; }
.cbtn { min-width: var(--control-hit); min-height: var(--control-hit); font-size: 1.25rem; }
.decline { min-height: var(--control-hit); }
</style>
<style>
html.dt-xl .recalc-period { display: none; }
html.dt-xl .recalc-title { font-size: 1.15rem; }
html.dt-xl .recalc-decline {
  background: transparent; border-radius: 0; box-shadow: none;
  text-decoration: underline; text-underline-offset: 3px;
}
</style>
