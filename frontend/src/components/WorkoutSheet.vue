<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import WorkoutExercise, { type CellEdit } from "./WorkoutExercise.vue";
import { keyboardEntry } from "../lib/viewport";
import {
  clock,
  currentExercise,
  exerciseSummary,
  FIELD_LABELS,
  fieldDecimals,
  measureFields,
  parseField,
  restLeft,
  typeKey,
  undoneSets,
  workoutStatus,
  workoutTotals,
} from "../lib/workout";
import { loadExercises } from "../state/exercises";
import {
  addExercise,
  closeSummary,
  discardWorkout,
  exerciseItem,
  finishWorkout,
  removeExercise,
  restoreExercise,
  setValue,
  shiftRest,
  workout,
} from "../state/workout";
import { closeSheet, toast, toastError, ui } from "../ui";

// The workout being logged (docs/training.md, phase 2), and its summary once finished. Closing the sheet
// keeps the workout going; Train shows it to resume.
const open = computed(() => ui.sheet === "workout");
const active = computed(() => workout.active);
const view = ref<"log" | "add">("log");
const confirming = ref<null | "undone" | "empty" | "discard">(null);
const waiting = ref(false);
/** The exercise opened by tapping it. Null follows the first one with sets to do. */
const chosen = ref<string | null>(null);
const edit = reactive<CellEdit>({ key: null, index: 0, field: "kg", text: "", fresh: true });

const now = ref(Date.now());
let timer: number | undefined;
let buzzed: string | null = null;
function tick() {
  now.value = Date.now();
  const ends = active.value?.restEndsAt;
  if (ends && ends !== buzzed && Date.parse(ends) <= now.value) {
    buzzed = ends;
    navigator.vibrate?.(200);
  }
}
watch(open, (shown) => {
  window.clearInterval(timer);
  timer = undefined;
  if (!shown) {
    edit.key = null;
    confirming.value = null;
    return;
  }
  void loadExercises();
  tick();
  timer = window.setInterval(tick, 1000);
  view.value = active.value && !active.value.exercises.length ? "add" : "log";
}, { immediate: true });
onBeforeUnmount(() => window.clearInterval(timer));

const shownKey = computed(() => {
  const exercises = active.value?.exercises ?? [];
  return exercises.some((exercise) => exercise.key === chosen.value) ? chosen.value : active.value ? currentExercise(active.value) : null;
});
const left = computed(() => (active.value ? restLeft(active.value, now.value) : null));
const restShare = computed(() => (left.value == null || !active.value?.restFor ? 0 : Math.min(1, left.value / active.value.restFor)));
const keypadShown = computed(() => edit.key != null && !keyboardEntry.value && view.value === "log");
const editName = computed(() => {
  const exercise = active.value?.exercises.find((entry) => entry.key === edit.key);
  if (!exercise) return "";
  let n = 0;
  const label = exercise.sets.map((set) => (set.type === "warmup" ? "Warm-up" : set.type === "drop" ? "Drop set" : `Set ${++n}`))[edit.index];
  return `${label} · ${FIELD_LABELS[edit.field]}`;
});

// A finished exercise folds away and the next one opens, unless one was picked by hand and still has sets to do.
watch(() => active.value?.exercises.find((exercise) => exercise.key === chosen.value)?.sets.every((set) => set.doneAt), (allDone) => {
  if (allDone) chosen.value = null;
});

function padKey(key: string) {
  if (!edit.key) return;
  const start = edit.fresh && key !== "⌫" ? "" : edit.text;
  edit.fresh = false;
  edit.text = typeKey(start, key, edit.field);
  setValue(edit.key, edit.index, edit.field, parseField(edit.field, edit.text) ?? null);
}

/** The next cell along the row, then the next set's first; past the last set the keypad closes. */
function nextCell() {
  const exercise = active.value?.exercises.find((entry) => entry.key === edit.key);
  if (!exercise) return;
  const fields = measureFields(exerciseItem(exercise.exerciseId)?.measure ?? "weight_reps");
  const at = fields.indexOf(edit.field);
  const [index, field] = at < fields.length - 1 ? [edit.index, fields[at + 1]] : [edit.index + 1, fields[0]];
  const cell = document.querySelector<HTMLInputElement>(`[data-cell="${exercise.key}-${index}-${field}"]`);
  if (cell) cell.focus();
  else doneTyping();
}

function doneTyping() {
  (document.activeElement as HTMLElement | null)?.blur();
  edit.key = null;
}

async function pick(exerciseId: string) {
  const key = await addExercise(exerciseId);
  chosen.value = key;
  view.value = "log";
  await nextTick();
  document.querySelector(`[data-workout-exercise="${exerciseId}"][data-open]`)?.scrollIntoView({ block: "nearest" });
}

function remove(key: string) {
  const removed = removeExercise(key);
  if (!removed) return;
  const name = exerciseItem(removed.exercise.exerciseId)?.name ?? "Exercise";
  toast(`${name} removed`, { label: "Undo", run: () => restoreExercise(removed) });
}

async function finish(anyway = false) {
  const current = active.value;
  if (!current || workout.saving) return;
  doneTyping();
  if (!current.exercises.some((exercise) => exercise.sets.some((set) => set.doneAt))) {
    confirming.value = "empty";
    return;
  }
  if (undoneSets(current) && !anyway) {
    confirming.value = "undone";
    return;
  }
  confirming.value = null;
  const outcome = await finishWorkout();
  if (outcome === "failed") toastError("Couldn't save the workout. Try again.");
  waiting.value = outcome === "waiting";
  chosen.value = null;
}

function discard() {
  discardWorkout();
  confirming.value = null;
  chosen.value = null;
  closeSheet();
  toast("Workout discarded");
}

function closeDone() {
  closeSummary();
  closeSheet();
}

const summary = computed(() => {
  const done = workout.summary;
  if (!done) return null;
  const minutes = done.endedAt ? Math.max(1, Math.round((Date.parse(done.endedAt) - Date.parse(done.startedAt)) / 60000)) : null;
  const totals = workoutTotals(done);
  return {
    time: minutes == null ? "—" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`,
    sets: totals.sets,
    volume: totals.volumeKg ? `${Math.round(totals.volumeKg).toLocaleString("en-GB")} kg` : "—",
    exercises: done.exercises.map((exercise) => {
      const item = exerciseItem(exercise.exerciseId);
      return { key: exercise.key, name: item?.name ?? exercise.exerciseId, line: exerciseSummary(exercise.sets, item?.measure ?? "weight_reps") };
    }),
  };
});
const label = computed(() => (summary.value && !active.value ? "Workout done" : view.value === "add" ? "Add exercise" : active.value?.name ?? "Workout"));
</script>

<template>
  <BottomSheet :open="open" :label="label" full @close="closeSheet">
    <template #header>
      <div v-if="!active && summary" class="row hdr">
        <h2 class="t-head m0 grow">Workout done</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeDone"><Icon name="x" :size="18" /></button>
      </div>
      <div v-else-if="view === 'add'" class="row hdr">
        <button type="button" class="cbtn" aria-label="Back to the workout" @click="view = 'log'"><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">Add exercise</h2>
      </div>
      <div v-else-if="active" class="row hdr">
        <span class="col grow g2">
          <h2 class="t-head m0">{{ active.name ?? "Workout" }}</h2>
          <span class="t-capn c2" data-workout-status>{{ workoutStatus(active, now) }}</span>
        </span>
        <button type="button" class="btn sm primary t-label" :disabled="workout.saving" @click="finish()">Finish</button>
        <button type="button" class="cbtn" aria-label="Hide the workout" @click="closeSheet"><Icon name="down" :size="18" /></button>
      </div>
    </template>

    <div v-if="!active && summary" class="col body" data-workout-summary>
      <div class="row stats">
        <div class="col stat"><span class="t-capn c2">Time</span><span class="t-head">{{ summary.time }}</span></div>
        <div class="col stat"><span class="t-capn c2">Sets</span><span class="t-head">{{ summary.sets }}</span></div>
        <div class="col stat"><span class="t-capn c2">Volume</span><span class="t-head">{{ summary.volume }}</span></div>
      </div>
      <p v-if="waiting" class="t-label c2 m0" role="status">Saved on this phone. It goes to your account when you're back online.</p>
      <ul class="col done">
        <li v-for="exercise in summary.exercises" :key="exercise.key" class="row drow">
          <span class="t-body grow dname">{{ exercise.name }}</span>
          <span class="t-label c2 dline">{{ exercise.line }}</span>
        </li>
      </ul>
    </div>

    <ExerciseBrowser v-else-if="view === 'add'" title="Exercises" title-id="workout-add-title" action="add" @pick="pick" />

    <div v-else-if="active" class="col body">
      <div v-if="confirming" class="card outline confirm" role="alertdialog" aria-labelledby="wc-h" aria-describedby="wc-d">
        <template v-if="confirming === 'undone'">
          <h3 id="wc-h" class="t-head m0">Finish now?</h3>
          <p id="wc-d" class="t-label c2 m0">{{ undoneSets(active) }} {{ undoneSets(active) === 1 ? "set isn't" : "sets aren't" }} ticked off. They're left out.</p>
          <div class="row cbtns">
            <button type="button" class="btn sm primary t-label" @click="finish(true)">Finish</button>
            <button type="button" class="btn sm secondary t-label" @click="confirming = null">Keep going</button>
          </div>
        </template>
        <template v-else>
          <h3 id="wc-h" class="t-head m0">{{ confirming === "empty" ? "Nothing ticked off yet" : "Discard this workout?" }}</h3>
          <p id="wc-d" class="t-label c2 m0">{{ confirming === "empty" ? "Tick off a set to finish, or discard the workout." : "Nothing in it is saved." }}</p>
          <div class="row cbtns">
            <button type="button" class="btn sm secondary t-label" @click="discard">Discard</button>
            <button type="button" class="btn sm primary t-label" @click="confirming = null">Keep going</button>
          </div>
        </template>
      </div>

      <div v-if="!active.exercises.length" class="card inset empty">
        <span class="t-label c2">No exercises yet. Add the first one to start ticking off sets.</span>
      </div>
      <WorkoutExercise
        v-for="exercise in active.exercises" :key="exercise.key" :exercise="exercise" :open="exercise.key === shownKey" :edit="edit"
        @expand="chosen = exercise.key" @remove="remove(exercise.key)"
      />
      <div class="row more">
        <button type="button" class="btn sm secondary t-label" @click="view = 'add'"><Icon name="plus" :size="14" /> Exercise</button>
        <span class="grow" />
        <button type="button" class="btn sm secondary t-label" @click="confirming = 'discard'"><Icon name="trash" :size="14" /> Discard</button>
      </div>
    </div>

    <template v-if="!active && summary" #footer>
      <button type="button" class="btn primary block t-bodys" @click="closeDone">Done</button>
    </template>
    <template v-else-if="keypadShown" #footer>
      <div class="col pad" @mousedown.prevent>
        <span class="t-capn c2">{{ editName }}</span>
        <Keypad :decimal="fieldDecimals(edit.field) > 0" @key="padKey" />
        <div class="row padacts">
          <button type="button" class="btn secondary t-bodys" @click="nextCell">Next</button>
          <button type="button" class="btn primary t-bodys" @click="doneTyping">Done</button>
        </div>
      </div>
    </template>
    <template v-else-if="active && left != null && view === 'log'" #footer>
      <div class="col" data-rest>
        <div class="row rest">
          <span class="col grow g2">
            <span class="t-capn c2">{{ left ? "Rest" : "Rest over" }}</span>
            <span class="t-ns" role="timer" aria-live="off">{{ clock(left) }}</span>
          </span>
          <button type="button" class="btn sm secondary t-label" aria-label="15 seconds less" @click="shiftRest(-15)">−15</button>
          <button type="button" class="btn sm secondary t-label" aria-label="15 seconds more" @click="shiftRest(15)">+15</button>
          <button type="button" class="btn sm primary t-label" @click="shiftRest(null)">{{ left ? "Skip" : "OK" }}</button>
        </div>
        <span class="restbar" aria-hidden="true"><span class="restfill" :style="{ transform: `scaleX(${restShare})` }" /></span>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
/* The large text sizes wrap every .row (main.css); the header keeps its buttons beside the title. */
.row.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.body { gap: var(--space-s); padding-bottom: var(--space-l); }
.confirm { gap: var(--space-s); }
.cbtns { gap: var(--space-s); flex-wrap: wrap; }
.empty { padding: var(--space-m); }
.more { gap: var(--space-s); padding-top: var(--space-xs); }
.pad { gap: var(--space-s); }
.padacts { gap: var(--space-s); flex-wrap: nowrap; }
.padacts .btn { flex: 1 1 0; }
.rest { gap: var(--space-s); flex-wrap: nowrap; }
.restbar { display: block; height: 3px; border-radius: var(--radius-pill); background: var(--color-surface-2); margin-top: var(--space-s); overflow: hidden; }
.restfill { display: block; width: 100%; height: 100%; background: var(--color-action); transform-origin: left; transition: transform 1s linear; }
.stats { gap: var(--space-s); flex-wrap: nowrap; }
.stat { flex: 1 1 0; min-width: 0; gap: var(--space-2xs); padding: var(--space-m); border-radius: var(--radius-l); background: var(--color-surface-2); }
.dt-xl .stats { flex-wrap: wrap; }
.dt-xl .stat { flex-basis: 100%; }
.done { list-style: none; margin: 0; padding: 0; }
.drow { gap: var(--space-m); padding-block: var(--space-s); border-bottom: 1px solid var(--color-border); align-items: baseline; }
.dname, .dline { min-width: 0; overflow-wrap: anywhere; }
.dline { text-align: right; }
</style>
