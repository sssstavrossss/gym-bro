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
      <span class="t-cap letter" :class="day.disabled ? 'c3' : 'c2'" aria-hidden="true">{{ day.letter }}</span>
      <span class="circle t-bodys" :class="{ on: day.date === selected, off: day.disabled }">{{ day.number }}</span>
      <span class="dot" :class="{ on: day.logged && day.date !== selected }" />
    </button>
  </div>
</template>

<style scoped>
.week { justify-content: space-between; }
.day { width: 44px; min-height: 44px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.day:disabled { cursor: default; }
.letter { font-size: min(0.6471rem, 15px); line-height: 1.2; }
.circle { width: 36px; height: 36px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: min(0.8824rem, 20px); line-height: 1; }
.circle.on { background: var(--color-action); color: var(--color-on-action); }
.circle.off { color: var(--text-tertiary); }
.dot { width: 4px; height: 4px; border-radius: 2px; }
.dot.on { background: var(--text-secondary); }
</style>
