<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import ExerciseRow from "./ExerciseRow.vue";
import Icon from "./Icon.vue";
import { EXERCISE_AREAS, LIST_STEP, moreRows, searchExercises, type ExerciseArea } from "../lib/exercises";
import { exercises, loadExercises } from "../state/exercises";

// The exercise library: search, body-area chips and the list. The library sheet opens the how-to from it; the
// workout sheet adds the picked exercise. `bare` leaves the title to the sheet around it.
const props = withDefaults(defineProps<{ title: string; titleId: string; action?: "open" | "add" | "swap" | "match"; bare?: boolean; startArea?: ExerciseArea; focusSearch?: boolean }>(), { action: "open", bare: false, startArea: "all", focusSearch: true });
const emit = defineEmits<{ pick: [string] }>();
const query = ref("");
const area = ref<ExerciseArea>(props.startArea);
const found = computed(() => searchExercises(exercises.items, query.value, area.value));
/** Thumbnails that failed to load (no photos in development, or offline before they were kept). */
const broken = reactive(new Set<string>());

// Rows draw a step at a time: more come as the end nears (or with Show more), and a new search starts over.
const limit = ref(LIST_STEP);
watch([query, area], () => (limit.value = LIST_STEP));
const visible = computed(() => found.value.slice(0, limit.value));
function showMore() {
  limit.value = moreRows(limit.value, found.value.length);
}
const more = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (!("IntersectionObserver" in window)) return;
  // Watch against the sheet body that scrolls the list (WebKit doesn't clip by it otherwise), else the page.
  const scroller = root.value?.closest<HTMLElement>(".sheet-body") ?? null;
  observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) showMore(); }, { root: scroller, rootMargin: "0px 0px 600px 0px" });
  if (more.value) observer.observe(more.value);
});
watch(more, (element, old) => {
  if (old) observer?.unobserve(old);
  if (element) observer?.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section ref="root" class="col lib" :aria-labelledby="titleId">
    <div v-if="!bare" class="row lhead">
      <h2 :id="titleId" class="t-cap c3 section-title grow">{{ title }}</h2>
      <span v-if="exercises.state === 'ready'" class="t-capn c3" data-exercise-count>{{ found.length }}</span>
    </div>
    <label class="field row">
      <Icon name="search" :size="18" class="c2" />
      <input
        v-model="query" :data-no-autofocus="focusSearch ? undefined : ''" class="t-body grow" type="search" placeholder="Squat, dumbbell, chest…" aria-label="Search exercises"
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
      <li v-for="item in visible" :key="item.id">
        <ExerciseRow :item="item" :action="action" :broken="broken" @pick="emit('pick', $event)" />
      </li>
    </ul>
    <button v-if="found.length > limit" ref="more" type="button" class="btn sm secondary t-label more" data-exercise-more @click="showMore">Show more</button>
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
.lib .field, .lib .areas { flex-wrap: nowrap; }
.note { padding-block: var(--space-m); gap: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; }
.more { align-self: center; }
</style>
