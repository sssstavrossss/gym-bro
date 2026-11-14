<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import type { RecalculateCalendarDay } from "../api";
import { addDays, weekStart } from "../lib/dates";

const props = defineProps<{ days: RecalculateCalendarDay[]; selected: string }>();
const emit = defineEmits<{ pick: [RecalculateCalendarDay] }>();

const byDate = computed(() => new Map(props.days.map((day) => [day.date, day])));
const weeks = computed(() => {
  if (!props.days.length) return [] as { start: string; cells: (RecalculateCalendarDay | null)[] }[];
  const first = weekStart(props.days[0].date);
  const last = weekStart(props.days[props.days.length - 1].date);
  const rows = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    const cells = [];
    for (let i = 0; i < 7; i += 1) cells.push(byDate.value.get(addDays(start, i)) ?? null);
    rows.push({ start, cells });
  }
  return rows;
});

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)));
}

function kcalLabel(kcal: number | null): string {
  if (kcal == null) return "";
  if (kcal >= 1000) return `${(kcal / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(kcal);
}

function label(day: RecalculateCalendarDay): string {
  const amount = day.kcal == null ? "no log" : `${day.kcal} kcal`;
  const state = !day.counted ? "left out, tap to switch"
    : day.status === "low" ? "low, counted"
    : day.status === "nolog" ? "counted as 0"
    : "counted";
  return `${day.date}, ${amount}, ${state}`;
}
</script>

<template>
  <section class="card" aria-label="Days in this period">
    <div class="cal" role="group" aria-label="Recalculation days">
      <div class="calrow letters">
        <span v-for="(letter, index) in ['M','T','W','T','F','S','S']" :key="index" class="t-cap c3">{{ letter }}</span>
      </div>
      <div v-for="week in weeks" :key="week.start" class="calrow">
        <button
          v-for="(day, index) in week.cells"
          :key="day?.date ?? `${week.start}-${index}`"
          type="button"
          class="tile"
          :class="day ? [day.status, { out: !day.counted, picked: day.date === selected }] : 'empty'"
          :disabled="!day"
          :aria-pressed="day ? day.date === selected : undefined"
          :aria-label="day ? label(day) : undefined"
          @click="day && emit('pick', day)"
        >
          <template v-if="day">
            <span v-if="day.counted" class="tick" aria-hidden="true"><Icon name="check" :size="10" :sw="3.2" /></span>
            <span class="t-label num">{{ dayNumber(day.date) }}</span>
            <span class="t-capn kcal">{{ day.kcal == null ? (day.counted ? "0" : "") : kcalLabel(day.kcal) }}</span>
          </template>
        </button>
      </div>
    </div>
    <div class="legend t-capn c2">
      <span><i class="sw low" /> low (≤80%)</span>
      <span><i class="sw nolog" /> not logged</span>
      <span><i class="sw counted" /> counted</span>
      <span><i class="sw out" /> left out · tap to switch</span>
    </div>
  </section>
</template>

<style scoped>
.card {
  display: flex; flex-direction: column; gap: var(--space-gap);
  padding: var(--space-gap); border: 1px solid var(--color-border); border-radius: var(--radius-card);
  background: var(--color-surface);
}
.cal { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); }
.calrow { display: flex; gap: 4px; }
.calrow > * { flex: 1 1 0; min-width: 0; }
.letters { min-height: 16px; text-align: center; }
.tile {
  position: relative; min-height: var(--control-hit); border-radius: 10px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  color: var(--text-primary); background: var(--color-surface-2);
}
.tile.empty { background: transparent; }
.tile.low { box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
.tile.nolog { background: transparent; outline: 1px dashed var(--color-border); outline-offset: -3px; }
.tile.out { background: transparent; color: var(--text-tertiary); }
.tile.picked { box-shadow: inset 0 0 0 2px var(--color-action); }
.tick { position: absolute; top: 3px; right: 3px; color: var(--text-secondary); }
.num, .kcal { font-variant-numeric: tabular-nums; line-height: 1.1; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; min-height: 16px; }
.sw { width: 12px; height: 12px; border-radius: 3px; flex: none; background: var(--color-surface-2); }
.sw.low { box-shadow: inset 0 0 0 1.5px var(--text-secondary); background: transparent; }
.sw.nolog { background: transparent; outline: 1px dashed var(--color-border); outline-offset: -2px; }
.sw.counted { background: var(--color-surface-2); }
.sw.out { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-border); }
</style>
