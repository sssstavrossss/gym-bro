<script setup lang="ts">
import Icon from "./Icon.vue";
import { exerciseLine, photoUrl, type ExerciseItem } from "../lib/exercises";
import { exercises } from "../state/exercises";

// One exercise in a list: its photo, name and line. The library's rows, and the swap list's.
const props = defineProps<{ item: ExerciseItem; action: "open" | "add" | "swap" | "match"; broken: Set<string> }>();
const emit = defineEmits<{ pick: [string] }>();
const labels = { open: undefined, add: (name: string) => `Add ${name}`, swap: (name: string) => `Swap to ${name}`, match: (name: string) => `Use ${name}` };
const icons = { open: "right", add: "plus", swap: "swap", match: "check" };
const label = () => labels[props.action]?.(props.item.name);
</script>

<template>
  <button type="button" class="row erow" :data-exercise="item.id" :aria-label="label()" @click="emit('pick', item.id)">
    <span class="thumb" aria-hidden="true">
      <img
        v-if="item.images && !broken.has(item.id)" :src="photoUrl(exercises.photos, item.id, 0)" alt=""
        loading="lazy" decoding="async" @error="broken.add(item.id)"
      />
      <Icon v-else name="dumbbell" :size="16" />
    </span>
    <span class="col grow text">
      <span class="t-body name">{{ item.name }}</span>
      <span class="t-label c2 line">{{ exerciseLine(item) }}</span>
    </span>
    <Icon :name="icons[action]" :size="16" class="c3" />
  </button>
</template>

<style scoped>
/* The large text sizes wrap every .row (main.css); this one stays on one line. */
.row.erow {
  width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0; flex-wrap: nowrap;
  background: none; border: 0; border-bottom: 1px solid var(--color-border); color: inherit; text-align: left;
}
.thumb {
  width: 48px; aspect-ratio: 3 / 2; flex: none; border-radius: var(--radius-s); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-surface-2); color: var(--text-secondary); box-shadow: var(--d-edge);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.text { gap: var(--space-2xs); min-width: 0; }
.name, .line { overflow-wrap: anywhere; }
</style>
