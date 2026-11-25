<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ExerciseBrowser from "../components/ExerciseBrowser.vue";
import Icon from "../components/Icon.vue";
import OfflineLine from "../components/OfflineLine.vue";
import { workoutStatus } from "../lib/workout";
import { loadExercises } from "../state/exercises";
import { startWorkout, workout } from "../state/workout";
import { openExercise, openWorkout } from "../ui";

// Training (docs/training.md): start or resume a workout, and the exercise library. Plans and the
// calendar arrive above it in later steps.
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  void loadExercises();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const status = computed(() => (workout.active ? workoutStatus(workout.active, now.value) : ""));

function start() {
  startWorkout();
  openWorkout();
}
</script>

<template>
  <main class="screen train">
    <header class="screen-head">
      <h1 class="t-title">Train</h1>
    </header>
    <OfflineLine />

    <section class="card" aria-labelledby="workout-title" data-workout-card>
      <div class="row wrow">
        <span class="col grow g2">
          <h2 id="workout-title" class="t-head m0">{{ workout.active ? "Workout in progress" : "Workout" }}</h2>
          <span v-if="workout.active" class="t-capn c2">{{ status }}</span>
          <span v-else class="t-capn c2">Add exercises as you go and tick off each set.</span>
        </span>
        <button v-if="workout.active" type="button" class="btn primary t-label" @click="openWorkout"><Icon name="play" :size="16" /> Resume</button>
        <button v-else type="button" class="btn primary t-label" @click="start"><Icon name="play" :size="16" /> Start</button>
      </div>
      <p v-if="workout.pending.length" class="t-capn c2 m0" role="status">
        {{ workout.pending.length === 1 ? "1 workout is" : `${workout.pending.length} workouts are` }} waiting to send. They go when you're back online.
      </p>
    </section>

    <ExerciseBrowser title="Exercises" title-id="exercises-title" @pick="openExercise" />
  </main>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.wrow { gap: var(--space-m); }
.dt-xl .wrow .btn { flex: 1 1 100%; }
</style>
