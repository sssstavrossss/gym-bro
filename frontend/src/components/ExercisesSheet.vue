<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import Icon from "./Icon.vue";
import { exercises } from "../state/exercises";
import { closeSheet, openExercise, ui } from "../ui";

// The exercise library, opened from the search button on Train. A row opens its how-to over this sheet.
const open = computed(() => ui.sheet === "exercises");
</script>

<template>
  <BottomSheet :open="open" label="Exercises" full @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 id="library-title" class="t-head grow m0">Exercises</h2>
        <span v-if="exercises.state === 'ready'" class="t-capn c3" data-exercise-total>{{ exercises.items.length }}</span>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <ExerciseBrowser title="Exercises" title-id="library-title" bare :start-area="ui.exercisesArea" :focus-search="ui.exercisesSearch" recent @pick="openExercise" />
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.hdr { gap: var(--space-s); align-items: center; }
</style>
