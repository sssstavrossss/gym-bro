<script setup lang="ts">
import { computed } from "vue";
import CappedList from "./CappedList.vue";
import Icon from "./Icon.vue";
import type { RecalculateLowDay } from "../api";
import { dayMonth, weekdayShort } from "../lib/dates";
import { int } from "../lib/format";
import { lowChoice, lowSummary, lowTitle, percentOfTarget } from "../lib/recalculate";

/**
 * The low-day question on the recalculate sheet. Low days count unless the person leaves
 * them out, but the sheet asks before it accepts. Once answered it folds to one line.
 */
const props = defineProps<{
  days: RecalculateLowDay[];
  answered: boolean;
  countedKcal: number | null;
  leftOutKcal: number | null;
  busy: boolean;
}>();
const emit = defineEmits<{ count: []; leave: []; change: [] }>();

const choice = computed(() => lowChoice(props.days));
const both = computed(() => props.countedKcal != null && props.leftOutKcal != null);
</script>

<template>
  <section v-if="answered && choice" class="lowcard sum" aria-label="Low days" data-low-days="answered">
    <Icon name="check" :size="16" class="c2" />
    <span class="t-label grow">{{ lowSummary(days.length, choice) }}</span>
    <button type="button" class="btn sm secondary t-label" :disabled="busy" @click="emit('change')"><Icon name="edit" :size="14" /> Change</button>
  </section>
  <section v-else class="lowcard" aria-labelledby="low-h" data-low-days="open">
    <h3 id="low-h" class="lh"><Icon name="alert" :size="16" class="c2" /> {{ lowTitle(days.length) }}</h3>
    <p class="t-capn c2 cap">Under 80% of that day's target. Count them if that is what you ate. Leave them out if you forgot to log.</p>
    <CappedList :max-rows="5" :watch-key="days.length" class="list t-label">
      <div v-for="day in days" :key="day.date" class="lrow" data-low-day>
        <span class="grow">{{ weekdayShort(day.date) }} {{ dayMonth(day.date) }}</span>
        <span class="num">{{ int(day.kcal) }}</span>
        <span class="t-capn c2 num pct">{{ percentOfTarget(day) == null ? "" : `${percentOfTarget(day)}%` }}</span>
      </div>
    </CappedList>
    <div class="two">
      <button type="button" class="btn secondary t-label" :disabled="busy" data-count-low @click="emit('count')"><Icon name="check" :size="14" :sw="2.4" /> Count them</button>
      <button type="button" class="btn secondary t-label" :disabled="busy" data-leave-low @click="emit('leave')"><Icon name="x" :size="14" /> Leave them out</button>
    </div>
    <p v-if="both" class="t-capn c2 cap">Counted: target {{ int(countedKcal!) }}. Left out: {{ int(leftOutKcal!) }}.</p>
  </section>
</template>

<style scoped>
.lowcard { background: var(--color-surface-2); border-radius: var(--radius-l); padding: var(--space-m) var(--space-l); display: flex; flex-direction: column; gap: var(--space-s); --btn-bg: var(--color-surface); box-shadow: var(--d-edge); }
.sum { flex-direction: row; align-items: center; gap: var(--space-s); }
.lh { display: flex; align-items: center; gap: var(--space-s); margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.cap { margin: 0; }
.lrow { display: flex; align-items: baseline; gap: var(--space-s); padding: var(--space-s) 0; }
.lrow + .lrow { border-top: 1px solid var(--color-border); }
.num { font-variant-numeric: tabular-nums; text-align: right; }
.pct { width: 3.2em; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-s); }
.two .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs); }
/* CappedList fades into the card's own colour, not the sheet's. */
.lowcard :deep(.fade.top) { background: linear-gradient(to top, transparent, var(--color-surface-2) 90%); }
.lowcard :deep(.fade.bottom) { background: linear-gradient(to bottom, transparent, var(--color-surface-2) 88%); }
</style>
