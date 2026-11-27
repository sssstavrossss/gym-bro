<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import ExerciseRow from "./ExerciseRow.vue";
import Icon from "./Icon.vue";
import PageChips from "./PageChips.vue";
import SwipePanels from "./SwipePanels.vue";
import {
  areaFilter,
  EXERCISE_TYPES,
  inGroup,
  LIST_STEP,
  moreRows,
  MUSCLE_GROUPS,
  ofType,
  recentExercises,
  searchExercises,
  typeLabel,
  type ExerciseArea,
  type ExerciseItem,
  type ExerciseType,
} from "../lib/exercises";
import { exercises, loadExercises } from "../state/exercises";
import { loadHistory, workout, workoutHistory } from "../state/workout";

// The exercise library: search, then two rows. The first is the type (a filter, All first); the second names the
// muscle groups the list swipes between, like Add food's pages, wrapping at the ends. The library sheet opens the
// how-to from it; the workout sheet adds the picked exercise. `bare` leaves the title to the sheet around it.
// `recent` puts the exercises done lately at the top of All.
const props = withDefaults(defineProps<{
  title: string; titleId: string; action?: "open" | "add" | "swap" | "match"; bare?: boolean; startArea?: ExerciseArea; focusSearch?: boolean; recent?: boolean;
}>(), { action: "open", bare: false, startArea: "all", focusSearch: true, recent: false });
const emit = defineEmits<{ pick: [string] }>();
const start = areaFilter(props.startArea);
const query = ref("");
const type = ref<ExerciseType>(start.type);
const page = ref(Math.max(0, MUSCLE_GROUPS.findIndex((group) => group.id === start.group)));
/** The pager's position while it moves, for the chips' sliding pill. */
const position = ref<number | null>(null);
const pager = ref<InstanceType<typeof SwipePanels> | null>(null);
const chips = MUSCLE_GROUPS.map((group) => ({ label: group.label }));
const typeName = computed(() => EXERCISE_TYPES.find((entry) => entry.id === type.value)?.label ?? "All");

/** A chip turns the pager the short way round; the pager says which page is showing. */
function pickPage(at: number) {
  if (pager.value) pager.value.turn(at);
  else page.value = at;
}

/** Every match of the type, ranked once; each page keeps its muscle group's share in that order. */
const matches = computed(() => searchExercises(exercises.items, query.value, type.value));
/** All's list leaves out what Recent shows above it, so no exercise is listed twice. */
const found = computed(() => {
  const recent = new Set(recentRows.value.map((item) => item.id));
  return MUSCLE_GROUPS.map((group) => matches.value.filter((item) => inGroup(item, group.id) && !(group.id === "all" && recent.has(item.id))));
});
/** Rows are drawn only on the page in view and the ones beside it, so a swipe always has its next page ready. */
const near = computed(() => {
  const count = MUSCLE_GROUPS.length;
  return new Set([page.value, (page.value + 1) % count, (page.value + count - 1) % count]);
});

const recentIds = computed(() => {
  if (!props.recent) return [];
  const waiting = workout.pending.map((draft) => ({ exercises: draft.exercises.map((exercise) => exercise.exerciseId) }));
  const done = workoutHistory.rows.filter((row) => row.status !== "skipped");
  return recentExercises([...waiting, ...done]);
});
const recentRows = computed<ExerciseItem[]>(() => {
  if (query.value.trim()) return [];
  const byId = new Map(exercises.items.map((item) => [item.id, item]));
  return recentIds.value.flatMap((id) => {
    const item = byId.get(id);
    return item && ofType(item, type.value) ? [item] : [];
  });
});
/** Names the type on each row while every type is listed, so a SkiErg reads apart from a squat. */
const tagOf = (item: ExerciseItem) => (type.value === "all" ? typeLabel(item) : undefined);

/** Thumbnails that failed to load (no photos in development, or offline before they were kept). */
const broken = reactive(new Set<string>());

// Rows draw a step at a time: more come as the end nears (or with Show more), and a new search or page starts over.
const limit = ref(LIST_STEP);
watch([query, type, page], () => (limit.value = LIST_STEP));
const shownCount = computed(() => found.value[page.value]?.length ?? 0);
function showMore() {
  limit.value = moreRows(limit.value, shownCount.value);
}
function emptyLine(at: number) {
  const q = query.value.trim();
  if (q) return `No exercises match “${q}”${at ? ` in ${MUSCLE_GROUPS[at].label.toLowerCase()}` : ""}.`;
  return `No ${typeName.value.toLowerCase()} exercises for ${MUSCLE_GROUPS[at].label.toLowerCase()}. Try All.`;
}

const more = ref<HTMLElement | null>(null);
/** Show more sits inside the pages' v-for, where a plain ref would collect an array. */
const keepMore = (element: unknown) => { more.value = (element as HTMLElement | null) ?? null; };
const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (props.recent && workoutHistory.state === "idle") void loadHistory();
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
    <!-- The search and both rows of chips stay put at the top of the sheet; only the exercises scroll under them. -->
    <div class="col head" data-exercise-head>
    <div v-if="!bare" class="row lhead">
      <h2 :id="titleId" class="t-cap c3 section-title grow">{{ title }}</h2>
      <span v-if="exercises.state === 'ready'" class="t-capn c3" data-exercise-count>{{ shownCount }}</span>
    </div>
    <label class="field row">
      <Icon name="search" :size="18" class="c2" />
      <input
        v-model="query" :data-no-autofocus="focusSearch ? undefined : ''" class="t-body grow" type="search" placeholder="Squat, hyrox, chest, kettlebell…" aria-label="Search exercises"
        autocomplete="off" enterkeyhint="search"
      />
      <button v-if="query" type="button" class="clr c2" aria-label="Clear search" @click="query = ''"><Icon name="x" :size="16" /></button>
    </label>
    <div class="row types" role="group" aria-label="Type" data-exercise-types>
      <button
        v-for="entry in EXERCISE_TYPES" :key="entry.id" type="button" class="chip ring t-label" :class="{ on: type === entry.id }"
        :aria-pressed="type === entry.id" :data-exercise-type="entry.id" @click="type = entry.id"
      ><Icon v-if="entry.icon" :name="entry.icon" :size="14" /><span>{{ entry.label }}</span></button>
    </div>
    <PageChips :pages="chips" :current="page" :position="position" label="Muscle group" @pick="pickPage" />
    </div>

    <p v-if="exercises.state === 'loading' || exercises.state === 'idle'" class="t-label c2 m0 note">Loading exercises…</p>
    <div v-else-if="exercises.state === 'failed'" class="row note">
      <span class="t-label c2 grow">Couldn't load the exercises.</span>
      <button type="button" class="btn sm secondary t-label" @click="loadExercises">Try again</button>
    </div>
    <SwipePanels
      v-else ref="pager" class="pager" :count="MUSCLE_GROUPS.length" :start="page" :names="chips.map((chip) => chip.label)" label="Muscle groups"
      tight hide-offscreen quiet-dots :edges="false" @change="(at) => (page = at)" @progress="(at) => (position = at)"
    >
      <div v-for="(group, at) in MUSCLE_GROUPS" :key="group.id" class="col page" :data-exercise-page="group.id">
        <template v-if="near.has(at)">
          <template v-if="group.id === 'all' && recentRows.length">
            <h3 class="t-cap c2 section-title m0 sub">Recent</h3>
            <ul class="list" aria-label="Recent" data-exercise-recent>
              <li v-for="item in recentRows" :key="item.id">
                <ExerciseRow :item="item" :action="action" :broken="broken" :tag="tagOf(item)" @pick="emit('pick', $event)" />
              </li>
            </ul>
            <h3 class="t-cap c2 section-title m0 sub">{{ type === "all" ? "All exercises" : `All ${typeName.toLowerCase()}` }}</h3>
          </template>
          <p v-if="!found[at].length" class="t-label c2 m0 note">{{ emptyLine(at) }}</p>
          <ul v-else class="list" :aria-label="group.label">
            <li v-for="item in found[at].slice(0, limit)" :key="item.id">
              <ExerciseRow :item="item" :action="action" :broken="broken" :tag="tagOf(item)" @pick="emit('pick', $event)" />
            </li>
          </ul>
          <button v-if="at === page && found[at].length > limit" :ref="keepMore" type="button" class="btn sm secondary t-label more" data-exercise-more @click="showMore">Show more</button>
        </template>
      </div>
    </SwipePanels>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.lib { gap: var(--space-s); }
/* Pinned to the top of the scrolling sheet body, on the sheet's own colour, so rows slide under it out of sight. */
.head {
  position: sticky; top: 0; z-index: 1; gap: var(--space-s);
  background: var(--color-surface); padding-bottom: var(--space-xs);
}
.lhead { gap: var(--space-s); padding-top: var(--space-s); }
.field input::-webkit-search-cancel-button { display: none; }
.clr { width: var(--control-hit); height: var(--control-hit); margin-right: calc(-1 * var(--space-m)); display: inline-flex; align-items: center; justify-content: center; flex: none; }
/* Like the amount screen's quick chips: one row that scrolls sideways. */
.types {
  flex-wrap: nowrap; gap: var(--space-xs); overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  margin-inline: calc(-1 * var(--space-screen)); padding-inline: var(--space-screen);
}
.types::-webkit-scrollbar { display: none; }
.types .chip { flex: none; }
/* The large text sizes wrap every .row (main.css); these stay on one line and shorten their text instead. */
.lib .field, .lib .types { flex-wrap: nowrap; }
/* The chips' 44px hits overlap the gap; the type row and the page chips sit as close as Add food's. */
.types + :deep(.pchips) { margin-top: calc((var(--control-chip) - var(--control-hit)) / 2); }
.page { min-width: 0; }
.sub { padding-top: var(--space-s); }
.note { padding-block: var(--space-m); gap: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; }
.more { align-self: center; margin-top: var(--space-s); }
</style>
