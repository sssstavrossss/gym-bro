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
      <span class="dot" :class="{ on: day.logged && day.date !== selected }" />
    </button>
  </div>
</template>

<style scoped>
.week {
  justify-content: space-between; align-items: center;
  /* +2px on top offsets the cap sitting above the letter box, so the ink gap matches the space under the dot. */
  padding: calc(var(--space-gap) / 2 + 2px) calc(var(--space-gap) / 2) calc(var(--space-gap) / 2);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}
.day {
  position: relative; width: 44px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  color: var(--text-primary);
}
.day:disabled { cursor: default; }
.letter { display: block; font-size: min(0.6471rem, 15px); line-height: 1; color: var(--text-tertiary); }
.circle { width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: min(0.8824rem, 20px); line-height: 1; color: var(--text-primary); }
.circle.on { background: var(--color-action); color: var(--color-on-action); }
.circle.off { color: var(--text-tertiary); opacity: 0.72; }
.dot {
  position: absolute; left: 50%; bottom: 0; width: 4px; height: 4px;
  border-radius: 2px; transform: translateX(-50%);
}
.dot.on { background: var(--text-tertiary); }
</style>
