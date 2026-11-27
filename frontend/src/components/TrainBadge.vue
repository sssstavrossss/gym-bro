<script setup lang="ts">
// A workout on Home's week strip and calendar (README → Home): its kind's icon in a disc, filled in the accent when
// done, a ring when planned, and the accent's over colour when skipped. Decorative: the day's name says it.
import Icon from "./Icon.vue";
import { KIND_ICONS, type TrainState, type WorkoutKind } from "../lib/trainingDays";

withDefaults(defineProps<{ kind: WorkoutKind; state: TrainState; large?: boolean }>(), { large: false });
</script>

<template>
  <span class="tb" :class="[state, { large }]" :data-train-badge="`${kind} ${state}`" aria-hidden="true">
    <Icon :name="KIND_ICONS[kind]" :size="large ? 12 : 10" :sw="large ? 2.4 : 2.6" />
  </span>
</template>

<style scoped>
.tb { width: var(--badge); height: var(--badge); border-radius: var(--radius-pill); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.tb.large { width: var(--badge-l); height: var(--badge-l); }
.tb.done { background: var(--color-action); color: var(--color-on-action); }
.tb.planned { background: var(--color-surface); color: var(--text-secondary); box-shadow: inset 0 0 0 1px var(--text-tertiary); }
.tb.skipped { background: var(--over-text); color: var(--color-bg); }
</style>
