<script setup lang="ts">
import { computed } from "vue";
import { weekDays } from "../lib/dayLog";

const props = defineProps<{
  anchor: string;
  selected: string;
  today: string;
  setupDate: string;
  loggedDates: string[];
}>();
const emit = defineEmits<{ select: [string] }>();
const days = computed(() => weekDays(props.anchor, props.selected, props.today, props.setupDate, props.loggedDates));
</script>

<template>
  <div class="row week" role="group" aria-label="This week">
    <button
      v-for="day in days"
      :key="day.date"
      type="button"
      class="day"
      :disabled="day.disabled"
      :aria-pressed="day.date === selected"
      :aria-label="day.label"
      @click="emit('select', day.date)"
    >
      <span class="t-cap letter c3" aria-hidden="true">{{ day.letter }}</span>
      <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">{{ day.number }}</span>
      <span class="dotrow" aria-hidden="true"><span class="dot" :class="{ on: day.logged }" /></span>
    </button>
  </div>
</template>

<style scoped>
.week {
  justify-content: space-between; align-items: center;
  /* Bottom is the 12px token under the reserved dot row. Top is 1px less so the letter cap, which paints 1px below the padding edge, is also 12px from the band. */
  padding: calc(var(--space-gap) - 1px) calc(var(--space-gap) / 2) var(--space-gap);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}
.day {
  width: 44px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: var(--text-primary);
}
.day:disabled { cursor: default; }
.letter { display: block; font-size: min(0.6471rem, 15px); line-height: 1; color: var(--text-tertiary); }
.circle { width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: min(0.8824rem, 20px); line-height: 1; color: var(--text-primary); flex: none; }
.circle.on { background: var(--color-action); color: var(--color-on-action); }
.circle.off { color: var(--text-tertiary); opacity: 0.72; }
.dotrow { height: 4px; display: flex; align-items: center; justify-content: center; flex: none; }
.dot { width: 4px; height: 4px; border-radius: 2px; }
.dot.on { background: var(--text-tertiary); }
</style>
