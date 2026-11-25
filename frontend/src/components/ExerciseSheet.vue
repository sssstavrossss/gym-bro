<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import MuscleMap from "./MuscleMap.vue";
import { getExercise, type ExerciseDetail } from "../api";
import { demoUrl, exerciseFacts, muscleLabel, photoUrl } from "../lib/exercises";
import { exercises } from "../state/exercises";
import { closeExercise, ui } from "../ui";

// How to do one exercise. What the list already knows shows at once; the steps load from the API.
// From a workout it opens over the workout sheet, which stays open under it.
const open = computed(() => (ui.sheet === "exercise" || (ui.exerciseOver && ui.sheet === "workout")) && ui.exercise != null);
watch(() => ui.sheet, (sheet) => { if (sheet !== "workout") ui.exerciseOver = false; });
const item = computed(() => exercises.items.find((entry) => entry.id === ui.exercise) ?? null);
const detail = ref<ExerciseDetail | null>(null);
const state = ref<"loading" | "ready" | "failed">("loading");
const broken = reactive(new Set<number>());
let latest = 0;

async function load(id: string) {
  const ticket = ++latest;
  state.value = "loading";
  detail.value = null;
  broken.clear();
  try {
    const response = await getExercise(id);
    if (ticket !== latest) return;
    detail.value = response;
    state.value = "ready";
  } catch {
    if (ticket === latest) state.value = "failed";
  }
}

watch(() => (open.value ? ui.exercise : null), (id) => {
  if (id) void load(id);
}, { immediate: true });

const shown = computed(() => detail.value ?? item.value);
const photos = computed(() => {
  const base = detail.value?.photos ?? exercises.photos;
  const count = shown.value?.images ?? 0;
  return base ? Array.from({ length: Math.min(count, 2) }, (_, index) => index).filter((index) => !broken.has(index)) : [];
});
const credit = computed(() => (detail.value?.source === "gym-bro" ? "Steps written for Gym Bro" : "Photos and steps: free-exercise-db, public domain"));
</script>

<template>
  <BottomSheet :open="open" :label="shown?.name ?? 'Exercise'" @close="closeExercise">
    <template #header>
      <div class="row hdr">
        <div class="col grow">
          <h2 class="t-head m0">{{ shown?.name }}</h2>
          <span v-if="shown" class="t-label c2">{{ exerciseFacts(shown) }}</span>
        </div>
        <button type="button" class="cbtn" aria-label="Close" @click="closeExercise"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div v-if="shown" class="col body" data-exercise-sheet>
      <div v-if="photos.length" class="row pics">
        <img
          v-for="index in photos" :key="index" :src="photoUrl(detail?.photos ?? exercises.photos, shown.id, index)"
          :alt="index === 0 ? 'Start position' : 'End position'" decoding="async" @error="broken.add(index)"
        />
      </div>

      <section class="row muscles" aria-label="Muscles" data-exercise-muscles>
        <MuscleMap :primary="shown.primaryMuscles" :secondary="shown.secondaryMuscles" />
        <div class="col grow groups">
          <div class="col gap-xs">
            <h3 class="t-label c2 m0 key"><span class="dot main" aria-hidden="true" />Main</h3>
            <div class="row tags">
              <span v-for="m in shown.primaryMuscles" :key="m" class="tag t-capn">{{ muscleLabel(m) }}</span>
            </div>
          </div>
          <div v-if="shown.secondaryMuscles.length" class="col gap-xs">
            <h3 class="t-label c2 m0 key"><span class="dot help" aria-hidden="true" />Helping</h3>
            <div class="row tags">
              <span v-for="m in shown.secondaryMuscles" :key="m" class="tag t-capn">{{ muscleLabel(m) }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="col gap-s" aria-labelledby="exercise-steps">
        <h3 id="exercise-steps" class="t-label c2 m0">Steps</h3>
        <p v-if="state === 'loading'" class="t-body c2 m0">Loading…</p>
        <p v-else-if="state === 'failed'" class="t-body c2 m0">Couldn't load the steps.</p>
        <p v-else-if="!detail?.instructions.length" class="t-body c2 m0">No steps for this one yet.</p>
        <ol v-else class="t-body steps" data-exercise-steps>
          <li v-for="(step, index) in detail!.instructions" :key="index">{{ step }}</li>
        </ol>
      </section>

      <div class="row foot">
        <span class="t-capn c3 grow">{{ credit }}</span>
        <a class="btn sm secondary t-label" :href="demoUrl(shown.name)" target="_blank" rel="noopener noreferrer">
          <Icon name="external" :size="14" /> Watch a demo
        </a>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
/* The large text sizes wrap every .row (main.css); the × stays beside the name. */
.row.hdr { gap: var(--space-s); align-items: flex-start; flex-wrap: nowrap; }
.body { gap: var(--space-l); padding-bottom: var(--space-l); }
.gap-s { gap: var(--space-s); }
.pics { gap: var(--space-s); }
/* The photos have white backgrounds in both themes. */
.pics img { width: calc(50% - var(--space-s) / 2); aspect-ratio: 3 / 2; object-fit: cover; border-radius: var(--radius-m); background: var(--color-surface-2); }
/* The map stays its size; the names beside it wrap. */
.body .muscles { gap: var(--space-l); align-items: flex-start; flex-wrap: nowrap; }
.groups { gap: var(--space-m); min-width: 0; }
.gap-xs { gap: var(--space-xs); }
.key { display: flex; align-items: center; gap: var(--space-xs); }
.dot { width: var(--space-s); height: var(--space-s); border-radius: var(--radius-pill); flex: none; }
.dot.main { background: var(--muscle-main); }
.dot.help { background: var(--muscle-help); }
.tags { flex-wrap: wrap; gap: var(--space-xs); }
.steps { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: var(--space-s); }
.foot { gap: var(--space-m); }
.foot .btn { flex: none; text-decoration: none; }
</style>
