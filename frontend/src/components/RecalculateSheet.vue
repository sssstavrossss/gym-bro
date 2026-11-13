<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import { getRecalculate, previewRecalculate, saveRecalculate, type RecalculateReview } from "../api";
import { dayMonth } from "../lib/dates";
import { int, kg } from "../lib/format";
import { excludedDates } from "../lib/recalculate";
import { loadToday } from "../state/log";
import { loadProfile, profile } from "../state/profile";
import { closeSheet, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "recalculate");
const review = ref<RecalculateReview | null>(null);
const excluded = ref<string[]>([]);
const busy = ref(false);
const error = ref("");

const current = computed(() => profile.targets);
const proposed = computed(() => {
  const value = review.value;
  if (!value) return null;
  return value.enough && value.proposed ? value.proposed : value.formula;
});
const excludedLabels = computed(() => {
  const value = review.value;
  if (!value) return [];
  return value.days.filter((day) => excluded.value.includes(day.date)).map((day) => dayMonth(day.date));
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  excluded.value = [];
  error.value = "";
  void load(false);
});

async function load(preview: boolean) {
  busy.value = true;
  error.value = "";
  try {
    review.value = preview ? await previewRecalculate(excluded.value) : await getRecalculate();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Couldn't load the review.";
  } finally {
    busy.value = false;
  }
}

function toggle(date: string, canExclude: boolean) {
  if (!canExclude || busy.value) return;
  excluded.value = excluded.value.includes(date)
    ? excluded.value.filter((item) => item !== date)
    : [...excluded.value, date];
  void load(true);
}

async function accept() {
  if (busy.value || !review.value) return;
  const mode = review.value.enough && review.value.proposed ? "adaptive" : "formula";
  busy.value = true;
  error.value = "";
  try {
    const days = review.value.days;
    const ticked = new Set(excluded.value);
    await saveRecalculate(excludedDates(days, ticked), mode);
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

function decline() {
  closeSheet();
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
        <h2 class="t-head grow">Recalculate</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet">×</button>
      </div>
    </template>
    <div class="col body">
      <p v-if="!review && busy" class="t-label c2">Loading the days since your last recalculation…</p>
      <template v-else-if="review">
        <p v-if="review.periodDays > 0" class="t-body">
          {{ dayMonth(review.from) }} – {{ dayMonth(review.to) }} · {{ review.includedDays }} days included
          <template v-if="review.trendChangeKg != null"> · trend {{ kg(review.trendChangeKg) }} kg</template>
        </p>
        <p v-else class="t-body">No finished day since the last recalculation. Today is not included.</p>
        <p v-if="review.days.length === 0" class="t-label c2">No day in this period was under 90% of its target.</p>
        <ul v-else class="days">
          <li v-for="day in review.days" :key="day.date" class="row day">
            <label class="row grow hit">
              <input
                type="checkbox"
                :checked="!excluded.includes(day.date)"
                :disabled="!day.canExclude || busy"
                :aria-label="day.fasting ? `${dayMonth(day.date)} fasting, included` : `Include ${dayMonth(day.date)}`"
                @change="toggle(day.date, day.canExclude)"
              />
              <span class="col grow">
                <span class="t-bodys">{{ dayMonth(day.date) }}<template v-if="day.fasting"> · fasting</template></span>
                <span class="t-capn c2">{{ int(day.kcal) }} kcal<template v-if="day.targetKcal != null"> · target {{ int(day.targetKcal) }}</template></span>
              </span>
            </label>
          </li>
        </ul>
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
          <p class="t-label c2">{{ excludedLabels.length ? `Excluded: ${excludedLabels.join(", ")}` : "No days excluded." }}</p>
        </div>
        <button type="button" class="primary-btn t-bodys" :disabled="busy || !proposed" @click="accept">Accept</button>
        <button type="button" class="chip t-label" :disabled="busy" @click="decline">Decline</button>
      </template>
      <p v-if="error" class="t-body" role="alert">{{ error }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-gap); align-items: center; }
.body { gap: var(--space-gap); }
.days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); }
.day { min-height: var(--control-hit); }
.hit { gap: var(--space-gap); min-height: var(--control-hit); align-items: center; }
.hit input { width: 22px; height: 22px; flex: none; }
.compare { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); }
.compare p { margin: 0; }
.cbtn { font-size: 1.25rem; }
</style>
