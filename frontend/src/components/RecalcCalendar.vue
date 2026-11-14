<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { RecalculateCalendarDay } from "../api";
import { addDays, weekStart } from "../lib/dates";

const props = defineProps<{ days: RecalculateCalendarDay[]; selected: string }>();
const emit = defineEmits<{ pick: [RecalculateCalendarDay] }>();
const scroller = ref<HTMLElement | null>(null);
function scrollEnd() {
  const node = scroller.value;
  if (node) node.scrollTop = node.scrollHeight;
}
onMounted(() => nextTick(scrollEnd));
watch(() => props.days.length, () => nextTick(scrollEnd));

const byDate = computed(() => new Map(props.days.map((day) => [day.date, day])));
const weeks = computed(() => {
  if (!props.days.length) return [] as { start: string; cells: (RecalculateCalendarDay | null)[] }[];
  const first = weekStart(props.days[0].date);
  const last = weekStart(props.days[props.days.length - 1].date);
  const rows = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    const cells = [];
    for (let i = 0; i < 7; i += 1) {
      cells.push(byDate.value.get(addDays(start, i)) ?? null);
    }
    rows.push({ start, cells });
  }
  return rows;
});

function kcalLabel(kcal: number | null): string {
  if (kcal == null) return "";
  if (kcal >= 1000) {
    const compact = (kcal / 1000).toFixed(1).replace(/\.0$/, "");
    return `${compact}k`;
  }
  return String(kcal);
}

function label(day: RecalculateCalendarDay): string {
  const amount = day.kcal == null ? "no log" : `${day.kcal} kcal`;
  const state = day.status === "low" ? (day.counted ? "low, counted" : "low, left out")
    : day.status === "nolog" ? (day.counted ? "counted as 0" : "left out")
    : day.status;
  return `${day.date}, ${amount}, ${state}`;
}
</script>

<template>
  <div ref="scroller" class="scroller" role="group" aria-label="Recalculation days">
    <div class="cal">
      <div class="calrow letters">
        <span v-for="(letter, index) in ['M','T','W','T','F','S','S']" :key="index" class="t-cap c3">{{ letter }}</span>
      </div>
      <div v-for="week in weeks" :key="week.start" class="calrow">
        <button
          v-for="(day, index) in week.cells"
          :key="day?.date ?? `${week.start}-${index}`"
          type="button"
          class="tile"
          :class="day ? [day.status, { out: !day.counted, on: day.date === selected }] : 'empty'"
          :disabled="!day"
          :aria-pressed="day ? day.date === selected : undefined"
          :aria-label="day ? label(day) : undefined"
          @click="day && emit('pick', day)"
        >
          <template v-if="day">
            <span class="t-capn num">{{ day.kcal == null && !day.counted ? "" : kcalLabel(day.counted && day.kcal == null ? 0 : day.kcal) }}</span>
            <span v-if="day.status === 'nolog' && !day.counted" class="dot" aria-hidden="true" />
          </template>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scroller { max-height: 280px; overflow: auto; border-radius: var(--radius-card); background: var(--color-surface); }
.cal { display: flex; flex-direction: column; gap: calc(var(--space-gap) / 2); padding: var(--space-gap); }
.calrow { display: flex; gap: 4px; }
.calrow > * { flex: 1 1 0; min-width: 0; }
.letters { min-height: 16px; text-align: center; }
.tile {
  position: relative; min-height: var(--control-hit); border-radius: 10px;
  display: flex; align-items: center; justify-content: center; color: var(--text-primary);
  background: var(--color-surface-2);
}
.tile.empty { background: transparent; }
.tile.low { box-shadow: inset 0 0 0 1.5px var(--text-secondary); background: transparent; }
.tile.low.out { box-shadow: inset 0 0 0 1.5px var(--color-border); color: var(--text-tertiary); }
.tile.over { background: var(--shade-off); }
.tile.nolog { background: transparent; }
.tile.nolog.out { background: transparent; }
.tile.on { box-shadow: inset 0 0 0 2px var(--color-action); }
.num { font-variant-numeric: tabular-nums; }
.dot { width: 4px; height: 4px; border-radius: 2px; background: var(--text-tertiary); }
</style>
