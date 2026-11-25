<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Icon from "./Icon.vue";
import { EXERCISE_AREAS, exerciseLine, photoUrl, searchExercises, type ExerciseArea } from "../lib/exercises";
import { exercises, loadExercises } from "../state/exercises";

// The exercise library: search, body-area chips and the list. Train opens the how-to from it; the
// workout sheet adds the picked exercise.
withDefaults(defineProps<{ title: string; titleId: string; action?: "open" | "add" }>(), { action: "open" });
const emit = defineEmits<{ pick: [string] }>();
const query = ref("");
const area = ref<ExerciseArea>("all");
const found = computed(() => searchExercises(exercises.items, query.value, area.value));
/** Thumbnails that failed to load (no photos in development, or offline before they were kept). */
const broken = reactive(new Set<string>());
</script>

<template>
  <section class="col lib" :aria-labelledby="titleId">
    <div class="row lhead">
      <h2 :id="titleId" class="t-cap c3 section-title grow">{{ title }}</h2>
      <span v-if="exercises.state === 'ready'" class="t-capn c3" data-exercise-count>{{ found.length }}</span>
    </div>
    <label class="field row">
      <Icon name="search" :size="18" class="c2" />
      <input
        v-model="query" class="t-body grow" type="search" placeholder="Squat, dumbbell, chest…" aria-label="Search exercises"
        autocomplete="off" enterkeyhint="search"
      />
      <button v-if="query" type="button" class="clr c2" aria-label="Clear search" @click="query = ''"><Icon name="x" :size="16" /></button>
    </label>
    <div class="row areas" role="group" aria-label="Body area">
      <button
        v-for="a in EXERCISE_AREAS" :key="a.id" type="button" class="chip t-label" :class="{ on: area === a.id }"
        :aria-pressed="area === a.id" @click="area = a.id"
      ><span>{{ a.label }}</span></button>
    </div>

    <p v-if="exercises.state === 'loading' || exercises.state === 'idle'" class="t-label c2 m0 note">Loading exercises…</p>
    <div v-else-if="exercises.state === 'failed'" class="row note">
      <span class="t-label c2 grow">Couldn't load the exercises.</span>
      <button type="button" class="btn sm secondary t-label" @click="loadExercises">Try again</button>
    </div>
    <p v-else-if="!found.length" class="t-label c2 m0 note">No exercises match “{{ query.trim() }}”.</p>
    <ul v-else class="list" :aria-labelledby="titleId">
      <li v-for="item in found" :key="item.id">
        <button type="button" class="row erow" :data-exercise="item.id" :aria-label="action === 'add' ? `Add ${item.name}` : undefined" @click="emit('pick', item.id)">
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
          <Icon :name="action === 'add' ? 'plus' : 'right'" :size="16" class="c3" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.lib { gap: var(--space-s); }
.lhead { gap: var(--space-s); padding-top: var(--space-s); }
.field input::-webkit-search-cancel-button { display: none; }
.clr { width: var(--control-hit); height: var(--control-hit); margin-right: calc(-1 * var(--space-m)); display: inline-flex; align-items: center; justify-content: center; flex: none; }
/* Like the amount screen's quick chips: one row that scrolls sideways. */
.areas {
  flex-wrap: nowrap; gap: var(--space-xs); overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  margin-inline: calc(-1 * var(--space-screen)); padding-inline: var(--space-screen);
}
.areas::-webkit-scrollbar { display: none; }
.areas .chip { flex: none; }
/* The large text sizes wrap every .row (main.css); these stay on one line and shorten their text instead. */
.lib .field, .lib .areas, .list .erow { flex-wrap: nowrap; }
.note { padding-block: var(--space-m); gap: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; }
.erow {
  width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0;
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
