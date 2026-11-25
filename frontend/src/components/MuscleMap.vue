<script setup lang="ts">
import { computed } from "vue";
import { MUSCLE_SHAPES, muscleShades, type MuscleView } from "../lib/muscleMap";

// Front and back, side by side: main muscles in the action colour, the ones that help dimmer.
// Decorative: the muscle names beside it say the same in words.
const props = defineProps<{ primary: readonly string[]; secondary: readonly string[] }>();
const shades = computed(() => muscleShades(props.primary, props.secondary));
const views: MuscleView[] = ["front", "back"];

function tone(muscle: string | null) {
  if (!muscle) return "rest";
  return shades.value.get(muscle) ?? "idle";
}
</script>

<template>
  <div class="mmap row" aria-hidden="true">
    <svg v-for="view in views" :key="view" viewBox="0 0 100 210" :data-muscle-view="view">
      <template v-for="(shape, index) in MUSCLE_SHAPES[view]" :key="index">
        <path :d="shape.d" :class="tone(shape.muscle)" :data-muscle="shape.muscle ?? undefined" />
        <path v-if="shape.mirror" :d="shape.d" :class="tone(shape.muscle)" transform="matrix(-1 0 0 1 100 0)" />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.mmap { gap: var(--space-xs); flex: none; }
.mmap svg { height: var(--muscle-map-height); aspect-ratio: 100 / 210; display: block; }
.rest { fill: var(--muscle-rest); }
.idle { fill: var(--muscle-idle); }
.help { fill: var(--muscle-help); }
.main { fill: var(--muscle-main); }
</style>
