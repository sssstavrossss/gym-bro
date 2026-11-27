<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import SwapList from "./SwapList.vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import WorkoutExercise, { type CellEdit } from "./WorkoutExercise.vue";
import ExerciseScreen from "./ExerciseScreen.vue";
import SetEntry from "./SetEntry.vue";
import RestTimer from "./RestTimer.vue";
import TimedBlock from "./TimedBlock.vue";
import WorkoutDescribe from "./WorkoutDescribe.vue";
import WorkoutTimes from "./WorkoutTimes.vue";
import { keyboardEntry } from "../lib/viewport";
import { nextSetIndex, screenStatus, usesSetScreen } from "../lib/setEntry";
import {
  clockTime,
  currentExercise,
  exerciseGroups,
  exerciseSummary,
  groupName,
  groupOf,
  FIELD_LABELS,
  fieldDecimals,
  measureFields,
  parseField,
  partHeading,
  restLeft,
  samePart,
  shortDay,
  timesLabel,
  typeKey,
  undoneSets,
  workoutStatus,
  workoutTotals,
} from "../lib/workout";
import { todayInZone } from "../lib/dates";
import { newBestLine } from "../lib/records";
import { loadExercises } from "../state/exercises";
import { deviceTimeZone } from "../state/profile";
import {
  addExercise,
  swapExercise,
  closePast,
  closeSummary,
  deletePast,
  discardWorkout,
  exerciseItem,
  finishWorkout,
  forgetQuickTimes,
  quickTimes,
  removeExercise,
  restoreExercise,
  restorePast,
  restoreWorkout,
  savePast,
  setValue,
  toggleSuperset,
  workout,
} from "../state/workout";
import type { DraftExercise } from "../lib/workout";
import { distanceText } from "../lib/cardio";
import { formatLabel, scoreLine } from "../lib/timed";
import { canDescribe } from "../lib/describeWorkout";
import { leftLine, describeLeftShownAt } from "../lib/describe";
import { connection } from "../state/connection";
import { describe, loadDescribe } from "../state/describe";
import { findExercises, resetWorkoutDescribe, workoutDescribe } from "../state/workoutDescribe";
import { closeSheet, openExercise, toast, toastError, ui } from "../ui";

// The workout being logged (docs/training.md, phase 2), and its summary once finished. Closing the sheet
// keeps the workout going; Train shows it to resume. A past workout (opened from the history, or logged
// afterwards) is edited in the same sheet, with Save and Delete instead of Finish and no rest timer.
const open = computed(() => ui.sheet === "workout");
const active = computed(() => workout.active);
const past = computed(() => workout.past);
/** What the set tables edit: the past workout when one is open, else the live one. */
const current = computed(() => past.value?.draft ?? active.value);
const pastError = ref("");
const today = computed(() => todayInZone(deviceTimeZone(), new Date(now.value)));
const view = ref<"log" | "add" | "swap" | "describe" | "exercise">("log");
/** A quick workout's exercise on its own screen (ExerciseScreen), and the set picked there; null follows the next to do. */
const screenKey = ref<string | null>(null);
const picked = ref<number | null>(null);
/** The exercise being swapped, on the swap screen. */
const swapping = ref<{ key: string; exerciseId: string } | null>(null);
/** End's check, in the footer where End was tapped: sets not ticked off, or nothing ticked off at all. */
const confirming = ref<null | "undone" | "empty">(null);
/** The time card, opened from the header's time chip. */
const timesOpen = ref(false);
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
    // A quick workout closed before anything was added was never really started: it goes, quietly.
    const idle = workout.active;
    if (idle && !idle.exercises.length && !idle.plan && !workout.past) discardWorkout();
    forgetQuickTimes();
    edit.key = null;
    confirming.value = null;
    timesOpen.value = false;
    pastError.value = "";
    closePast();
    resetWorkoutDescribe();
    return;
  }
  void loadExercises();
  void loadDescribe();
  tick();
  timer = window.setInterval(tick, 1000);
  // Quick add opens with nothing started (README, *Logging a workout*): Add exercise, until the first exercise starts it.
  view.value = !current.value || !current.value.exercises.length ? "add" : "log";
  // Train's start card can open it on Describe a workout (once; the next open is the usual one).
  if (ui.workoutView === "describe" && !past.value) {
    workoutDescribe.error = "";
    view.value = "describe";
  }
  ui.workoutView = null;
}, { immediate: true });
onBeforeUnmount(() => window.clearInterval(timer));

const shownKey = computed(() => {
  const exercises = active.value?.exercises ?? [];
  return exercises.some((exercise) => exercise.key === chosen.value) ? chosen.value : active.value ? currentExercise(active.value) : null;
});
/** The open exercise's whole superset opens with it, so its sets can be done in turn. */
const activeRuns = computed(() => (active.value ? exerciseGroups(active.value.exercises) : []));
const shownKeys = computed(() => (active.value && shownKey.value ? groupOf(active.value.exercises, shownKey.value).map((exercise) => exercise.key) : []));
const left = computed(() => (active.value ? restLeft(active.value, now.value) : null));
const restShare = computed(() => (left.value == null || !active.value?.restFor ? 0 : Math.min(1, left.value / active.value.restFor)));
const keypadShown = computed(() => edit.key != null && !keyboardEntry.value && view.value === "log");
const editName = computed(() => {
  const exercise = current.value?.exercises.find((entry) => entry.key === edit.key);
  if (!exercise) return "";
  let n = 0;
  const label = exercise.sets.map((set) => (set.type === "warmup" ? "Warm-up" : set.type === "drop" ? "Drop set" : `Set ${++n}`))[edit.index];
  return `${label} · ${FIELD_LABELS[edit.field]}`;
});

// A finished exercise folds away and the next one opens, unless one was picked by hand and still has sets to do.
watch(() => (active.value && chosen.value ? groupOf(active.value.exercises, chosen.value).every((exercise) => exercise.sets.every((set) => set.doneAt)) : false), (allDone) => {
  if (allDone) chosen.value = null;
});

const nameOf = (exercise: DraftExercise | undefined) => (exercise ? exerciseItem(exercise.exerciseId)?.name ?? "Exercise" : "");

const screenExercise = computed(() => (view.value === "exercise" ? active.value?.exercises.find((exercise) => exercise.key === screenKey.value) ?? null : null));
const screenTarget = computed(() => {
  const sets = screenExercise.value?.sets ?? [];
  return picked.value != null && picked.value < sets.length ? picked.value : nextSetIndex(sets);
});
/** Opens an exercise on its own screen, on the next set to do. */
function openScreen(key: string) {
  screenKey.value = key;
  picked.value = null;
  timesOpen.value = false;
  edit.key = null;
  view.value = "exercise";
}
function closeScreen() {
  (document.activeElement as HTMLElement | null)?.blur();
  edit.key = null;
  view.value = "log";
}
// An exercise removed, or joined to a superset, goes back to the workout.
watch(() => view.value === "exercise" && (!screenExercise.value || !usesSetScreen(active.value, screenExercise.value.key)), (gone) => {
  if (gone) closeScreen();
});
function pickSet(index: number) {
  picked.value = index === nextSetIndex(screenExercise.value?.sets ?? []) ? null : index;
}
/** The exercise each superset button joins to: the one before. */
/** The one before, for the superset button; none across the warm-up, the workout and the cool-down. */
const prevName = (exercises: readonly DraftExercise[], exercise: DraftExercise) => {
  const before = exercises[exercises.indexOf(exercise) - 1];
  return before && samePart(before, exercise) ? nameOf(before) : nameOf(undefined);
};
/** A superset or circuit, or one exercise left on a clock: shown under a heading. */
const isRun = (run: readonly DraftExercise[]) => run.length > 1 || !!run[0]?.timed;
function runLabel(run: readonly DraftExercise[]) {
  const kind = run[0]?.timed ? formatLabel(run[0].timed) : groupName(run.length);
  return `${kind}: ${run.map((exercise) => nameOf(exercise)).join(", ")}`;
}

function join(exercises: readonly DraftExercise[], key: string) {
  const at = exercises.findIndex((exercise) => exercise.key === key);
  const before = exercises[at - 1];
  if (at < 1 || !before) return;
  const exercise = exercises[at];
  toggleSuperset(key);
  if (exercise.superset) {
    toast(`Split ${nameOf(before)} and ${nameOf(exercise)}`);
    return;
  }
  const run = groupOf(current.value?.exercises ?? [], key);
  toast(`${groupName(run.length)}: ${run.map((exercise) => nameOf(exercise)).join(" + ")}`);
}

function padKey(key: string) {
  if (!edit.key) return;
  const start = edit.fresh && key !== "⌫" ? "" : edit.text;
  edit.fresh = false;
  edit.text = typeKey(start, key, edit.field);
  setValue(edit.key, edit.index, edit.field, parseField(edit.field, edit.text) ?? null);
}

/** The next cell along the row, then the next set's first; past the last set the keypad closes. */
function nextCell() {
  const exercise = current.value?.exercises.find((entry) => entry.key === edit.key);
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
  timesOpen.value = false;
  if (key && !past.value && usesSetScreen(active.value, key)) {
    openScreen(key);
    return;
  }
  chosen.value = key;
  view.value = "log";
  await nextTick();
  document.querySelector(`[data-workout-exercise="${exerciseId}"][data-open]`)?.scrollIntoView({ block: "nearest" });
}

const canFind = computed(() => !workoutDescribe.finding && !connection.offline && describe.left > 0 && canDescribe(workoutDescribe.text));
const describeLeft = computed(() => (describe.left <= describeLeftShownAt ? leftLine({ limit: describe.limit, left: describe.left, nextAt: describe.nextAt }, deviceTimeZone()) : ""));

function startDescribe() {
  workoutDescribe.error = "";
  view.value = "describe";
}

async function findNow() {
  if (!canFind.value) return;
  // Back on the workout, the first exercise with sets to do opens.
  if (!(await findExercises())) return;
  chosen.value = null;
  view.value = "log";
}

/** Where the swap screen's ← goes: the exercise screen it was opened from, else the workout. */
const swapBack = ref<"log" | "exercise">("log");
function startSwap(exercise: { key: string; exerciseId: string }) {
  swapBack.value = view.value === "exercise" ? "exercise" : "log";
  swapping.value = { key: exercise.key, exerciseId: exercise.exerciseId };
  view.value = "swap";
}

async function swapTo(exerciseId: string) {
  const from = swapping.value;
  if (!from) return;
  const key = await swapExercise(from.key, exerciseId);
  swapping.value = null;
  view.value = "log";
  if (!key) return;
  chosen.value = key;
  const name = (id: string) => exerciseItem(id)?.name ?? "Exercise";
  toast(`Swapped ${name(from.exerciseId)} for ${name(exerciseId)}`);
  if (!past.value && usesSetScreen(active.value, key)) {
    openScreen(key);
    return;
  }
  await nextTick();
  document.querySelector(`[data-workout-exercise="${exerciseId}"][data-open]`)?.scrollIntoView({ block: "nearest" });
}

function remove(key: string) {
  const removed = removeExercise(key);
  if (!removed) return;
  const name = exerciseItem(removed.exercise.exerciseId)?.name ?? "Exercise";
  toast(`${name} removed`, { label: "Undo", run: () => restoreExercise(removed) });
}

/** End now, or at the end set on the time card. Sets not ticked off are left out, after asking. */
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
  const dropped = discardWorkout();
  confirming.value = null;
  chosen.value = null;
  closeSheet();
  if (!dropped) return;
  toast("Workout discarded", { label: "Undo", run: () => { if (!restoreWorkout(dropped)) toastError("Another workout has started since."); } });
}

/** The live footer's main button: "End now · 18:47", or "End at 19:10" once an end is set. */
const endLabel = computed(() => (active.value?.endedAt ? `End at ${clockTime(active.value.endedAt)}` : "End now"));
const endWhen = computed(() => (active.value?.endedAt ? "" : clockTime(now.value)));
/** A quick workout with nothing in it yet: Add exercise is its first screen, closed with × instead of going back. */
/** Quick add before its first exercise: no workout yet (or one emptied again), so Add exercise is its first page. */
const fresh = computed(() => !past.value && (!active.value || (!active.value.exercises.length && !active.value.plan)));
/** The times chip's: the workout's own, or those waiting for the first exercise. */
const times = computed(() => active.value ?? quickTimes);

function closeDone() {
  closeSummary();
  closeSheet();
}

const summary = computed(() => {
  const done = workout.summary;
  if (!done) return null;
  const minutes = done.endedAt && done.startedAt ? Math.max(1, Math.round((Date.parse(done.endedAt) - Date.parse(done.startedAt)) / 60000)) : null;
  const totals = workoutTotals(done);
  return {
    time: minutes == null ? "—" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`,
    sets: totals.sets,
    volume: totals.volumeKg ? `${Math.round(totals.volumeKg).toLocaleString("en-GB")} kg` : "—",
    // A run shows its distance where a lift shows volume; a workout with both shows both.
    distance: totals.metres ? distanceText(totals.metres) : "",
    showVolume: totals.volumeKg > 0 || !totals.metres,
    exercises: done.exercises.map((exercise) => {
      const item = exerciseItem(exercise.exerciseId);
      // A new best shows on the first card of its exercise.
      const best = done.exercises.find((other) => other.exerciseId === exercise.exerciseId) === exercise
        ? workout.bests.find((item) => item.exerciseId === exercise.exerciseId)
        : undefined;
      return {
        key: exercise.key,
        name: item?.name ?? exercise.exerciseId,
        line: exerciseSummary(exercise.sets, item?.measure ?? "weight_reps", exercise.exerciseId),
        best: best ? newBestLine(best) : "",
      };
    }),
    bests: workout.bests.length,
    scores: exerciseGroups(done.exercises).flatMap((run) => (run[0].timed ? [{ key: run[0].key, line: scoreLine(run[0].timed, run) }] : [])),
  };
});
const showSummary = computed(() => summary.value != null && !active.value && !past.value);
const pastTitle = computed(() => (past.value?.isNew ? "Log a workout" : "Edit workout"));
const swapTitle = computed(() => `Swap ${swapping.value ? exerciseItem(swapping.value.exerciseId)?.name ?? "exercise" : "exercise"}`);
const label = computed(() => (showSummary.value ? "Workout done" : screenExercise.value ? `Workout: ${nameOf(screenExercise.value)}` : view.value === "add" ? "Add exercise" : view.value === "describe" ? "Describe a workout" : view.value === "swap" ? swapTitle.value : past.value ? pastTitle.value : active.value?.name ?? "Workout"));

function setPastDate(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (past.value && /^\d{4}-\d{2}-\d{2}$/.test(value)) past.value.draft.date = value;
}

async function savePastNow() {
  doneTyping();
  const error = await savePast();
  pastError.value = error ?? "";
  if (error) return;
  closeSheet();
  toast("Workout saved");
}

async function deletePastNow() {
  doneTyping();
  const wasNew = past.value?.isNew;
  const result = await deletePast();
  if (typeof result === "string") {
    pastError.value = result;
    return;
  }
  closeSheet();
  if (wasNew) return;
  toast(`Workout on ${shortDay(result.date)} deleted`, {
    label: "Undo",
    run: () => void restorePast(result).then((ok) => { if (!ok) toastError("Couldn't bring the workout back."); }),
  });
}
</script>

<template>
  <BottomSheet :open="open" :label="label" full @close="closeSheet">
    <template #header>
      <div v-if="showSummary" class="row hdr">
        <h2 class="t-head m0 grow">Workout done</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeDone"><Icon name="x" :size="18" /></button>
      </div>
      <div v-else-if="view === 'add'" class="row hdr">
        <button v-if="!fresh" type="button" class="cbtn" aria-label="Back to the workout" @click="view = 'log'"><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">Add exercise</h2>
        <button
          v-if="fresh" type="button" class="btn sm secondary t-label tnum" :aria-expanded="timesOpen" aria-label="Times: starts now"
          data-workout-times-chip @click="timesOpen = !timesOpen"
        ><Icon name="clock" :size="14" /> {{ times.timesSet ? timesLabel(times) : "Now" }}</button>
        <button v-if="describe.available" type="button" class="btn sm secondary t-label" data-describe-workout @click="startDescribe"><Icon name="sparkle" :size="14" /> Describe</button>
        <button v-if="fresh" type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
      <div v-else-if="screenExercise" class="row hdr">
        <button type="button" class="cbtn" aria-label="Back to the workout" @click="closeScreen"><Icon name="left" :size="18" /></button>
        <span class="col grow g2">
          <h2 class="t-head m0">{{ nameOf(screenExercise) }}</h2>
          <span class="t-capn c2 tnum" data-exercise-status>{{ screenStatus(screenExercise.sets, screenTarget) }}</span>
        </span>
        <button type="button" class="cbtn" :aria-label="`How to do ${nameOf(screenExercise)}`" @click="openExercise(screenExercise.exerciseId)"><Icon name="info" :size="18" /></button>
      </div>
      <div v-else-if="view === 'describe'" class="row hdr">
        <!-- Before the first exercise there is no workout to go back to: ← is Quick add's first page, Add exercise. -->
        <button
          type="button" class="cbtn" :aria-label="fresh ? 'Back to Add exercise' : 'Back to the workout'" @click="view = fresh ? 'add' : 'log'"
        ><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">Describe a workout</h2>
      </div>
      <div v-else-if="view === 'swap'" class="row hdr">
        <button type="button" class="cbtn" :aria-label="swapBack === 'exercise' ? 'Back to the exercise' : 'Back to the workout'" @click="view = swapBack"><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">{{ swapTitle }}</h2>
      </div>
      <div v-else-if="past" class="row hdr">
        <span class="col grow g2">
          <h2 class="t-head m0">{{ pastTitle }}</h2>
          <span class="t-capn c2">{{ shortDay(past.draft.date) }}</span>
        </span>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
      <div v-else-if="active" class="row hdr">
        <span class="col grow g2">
          <h2 class="t-head m0">{{ active.name ?? "Workout" }}</h2>
          <span class="t-capn c2" data-workout-status>{{ workoutStatus(active, now) }}</span>
        </span>
        <button
          type="button" class="btn sm secondary t-label tnum" :aria-expanded="timesOpen" :aria-label="`Times: ${timesLabel(active)}`"
          data-workout-times-chip @click="timesOpen = !timesOpen"
        ><Icon name="clock" :size="14" /> {{ timesLabel(active) }}</button>
        <button type="button" class="cbtn" aria-label="Hide the workout" @click="closeSheet"><Icon name="down" :size="18" /></button>
      </div>
    </template>

    <div v-if="showSummary && summary" class="col body" data-workout-summary>
      <div class="row stats">
        <div class="col stat"><span class="t-capn c2">Time</span><span class="t-head">{{ summary.time }}</span></div>
        <div class="col stat"><span class="t-capn c2">Sets</span><span class="t-head">{{ summary.sets }}</span></div>
        <div v-if="summary.showVolume" class="col stat"><span class="t-capn c2">Volume</span><span class="t-head">{{ summary.volume }}</span></div>
        <div v-if="summary.distance" class="col stat" data-summary-distance><span class="t-capn c2">Distance</span><span class="t-head">{{ summary.distance }}</span></div>
      </div>
      <p v-for="item in summary.scores" :key="item.key" class="t-label m0" data-summary-score>{{ item.line }}</p>
      <p v-if="summary.bests" class="t-label m0" data-bests-count>{{ summary.bests === 1 ? "1 new best" : `${summary.bests} new bests` }}</p>
      <p v-if="waiting" class="t-label c2 m0" role="status">Saved on this phone. It goes to your account when you're back online.</p>
      <ul class="col done">
        <li v-for="exercise in summary.exercises" :key="exercise.key" class="row drow">
          <span class="col grow dname">
            <span class="t-body">{{ exercise.name }}</span>
            <span v-if="exercise.best" class="t-capn best" data-new-best><Icon name="check" :size="12" :sw="3" /><span>New best: {{ exercise.best }}</span></span>
          </span>
          <span class="t-label c2 dline">{{ exercise.line }}</span>
        </li>
      </ul>
    </div>

    <div v-else-if="view === 'add'" class="col addv">
      <WorkoutTimes v-if="fresh && timesOpen" :now="now" />
      <!-- No keyboard on the way in: the list is there to tap, and search waits for a tap. -->
      <ExerciseBrowser title="Exercises" title-id="workout-add-title" action="add" recent :focus-search="false" @pick="pick" />
    </div>
    <ExerciseScreen
      v-else-if="screenExercise && active" :key="screenExercise.key" :exercise="screenExercise" :target="screenTarget"
      :prev-name="prevName(active.exercises, screenExercise)"
      @select="pickSet" @swap="startSwap(screenExercise)" @remove="remove(screenExercise.key)" @superset="join(active.exercises, screenExercise.key)"
    />
    <WorkoutDescribe v-else-if="view === 'describe'" @find="findNow" />
    <SwapList v-else-if="view === 'swap' && swapping" :key="swapping.key" :exercise-id="swapping.exerciseId" @pick="swapTo" />

    <div v-else-if="past" class="col body" data-past-workout>
      <label class="field row day">
        <span class="t-label c2 grow">Day</span>
        <input class="t-body" type="date" :value="past.draft.date" :max="today" min="2000-01-01" aria-label="Day of the workout" data-no-autofocus @change="setPastDate" />
      </label>
      <p v-if="pastError" class="t-label m0" role="alert">{{ pastError }}</p>
      <div v-if="workoutDescribe.unmatched" class="well row unmatched" role="status" data-describe-unmatched>
        <span class="t-label grow">{{ workoutDescribe.unmatched }}</span>
        <button type="button" class="cbtn" aria-label="Dismiss" @click="workoutDescribe.unmatched = ''"><Icon name="x" :size="16" /></button>
      </div>
      <div v-if="!past.draft.exercises.length" class="card inset empty">
        <span class="t-label c2">No exercises yet. Add one, then tick off each set you did.</span>
      </div>
      <div
        v-for="run in exerciseGroups(past.draft.exercises)" :key="run[0].key" :class="isRun(run) ? 'col ss' : 'solo'"
        :role="isRun(run) ? 'group' : undefined" :aria-label="isRun(run) ? runLabel(run) : undefined" :data-superset="isRun(run) ? run.length : undefined"
      >
        <TimedBlock v-if="isRun(run)" :run="run" :live="false" :now="now" />
        <WorkoutExercise
          v-for="exercise in run" :key="exercise.key" :exercise="exercise" open past :edit="edit"
          :prev-name="prevName(past.draft.exercises, exercise)"
          @remove="remove(exercise.key)" @swap="startSwap(exercise)" @superset="join(past.draft.exercises, exercise.key)"
        />
      </div>
      <div class="row more">
        <button type="button" class="btn sm secondary t-label" @click="view = 'add'"><Icon name="plus" :size="14" /> Exercise</button>
        <button v-if="describe.available" type="button" class="btn sm secondary t-label" data-describe-workout @click="startDescribe"><Icon name="sparkle" :size="14" /> Describe</button>
      </div>
    </div>

    <div v-else-if="active" class="col body">
      <WorkoutTimes v-if="timesOpen" :now="now" />
      <div v-if="workoutDescribe.unmatched" class="well row unmatched" role="status" data-describe-unmatched>
        <span class="t-label grow">{{ workoutDescribe.unmatched }}</span>
        <button type="button" class="cbtn" aria-label="Dismiss" @click="workoutDescribe.unmatched = ''"><Icon name="x" :size="16" /></button>
      </div>
      <div v-if="!active.exercises.length" class="card inset empty">
        <span class="t-label c2">No exercises yet. Add the first one to start ticking off sets.</span>
      </div>
      <template v-for="(run, index) in activeRuns" :key="run[0].key">
        <h3 v-if="partHeading(activeRuns, index)" class="t-cap c2 m0 part" :data-part="run[0].part ?? 'main'">{{ partHeading(activeRuns, index) }}</h3>
        <div
          :class="isRun(run) ? 'col ss' : 'solo'"
          :role="isRun(run) ? 'group' : undefined" :aria-label="isRun(run) ? runLabel(run) : undefined" :data-superset="isRun(run) ? run.length : undefined"
        >
          <TimedBlock v-if="isRun(run)" :run="run" :live="true" :now="now" />
          <WorkoutExercise
            v-for="exercise in run" :key="exercise.key" :exercise="exercise" :open="!usesSetScreen(active, exercise.key) && shownKeys.includes(exercise.key)" :edit="edit"
            :prev-name="prevName(active.exercises, exercise)"
            @expand="usesSetScreen(active, exercise.key) ? openScreen(exercise.key) : (chosen = exercise.key)" @remove="remove(exercise.key)" @swap="startSwap(exercise)" @superset="join(active.exercises, exercise.key)"
          />
        </div>
      </template>
      <div class="row more">
        <button type="button" class="btn sm secondary t-label" @click="view = 'add'"><Icon name="plus" :size="14" /> Exercise</button>
        <button v-if="describe.available" type="button" class="btn sm secondary t-label" data-describe-workout @click="startDescribe"><Icon name="sparkle" :size="14" /> Describe</button>
      </div>
    </div>

    <template v-if="showSummary" #footer>
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
    <template v-else-if="screenExercise" #footer>
      <SetEntry :exercise="screenExercise" :target="screenTarget" :edit="edit" :left="left" @logged="picked = null" @next="picked = null" @done="closeScreen" />
    </template>
    <template v-else-if="view === 'describe'" #footer>
      <div class="col">
        <button type="button" class="btn primary block t-bodys" :disabled="!canFind" @click="findNow">
          <Icon name="sparkle" :size="18" /><span>{{ workoutDescribe.finding ? "Finding…" : "Find exercises" }}</span>
        </button>
        <p v-if="describeLeft" class="t-capn c3 dleft" role="status">{{ describeLeft }}</p>
      </div>
    </template>
    <template v-else-if="past && view === 'log'" #footer>
      <div class="row pastacts">
        <button v-if="!past.isNew" type="button" class="btn secondary t-bodys" :disabled="workout.saving" @click="deletePastNow"><Icon name="trash" :size="16" /> Delete</button>
        <button type="button" class="btn primary t-bodys grow" :disabled="workout.saving" @click="savePastNow">Save</button>
      </div>
    </template>
    <template v-else-if="active && view === 'log'" #footer>
      <RestTimer v-if="left != null" :left="left" :share="restShare" />
      <!-- End's check takes End's place, so the answer is under the finger that asked. -->
      <div v-if="confirming" class="col confirm" role="alertdialog" aria-labelledby="wc-h" aria-describedby="wc-d" data-end-confirm>
        <template v-if="confirming === 'undone'">
          <h3 id="wc-h" class="t-bodys m0">End the workout?</h3>
          <p id="wc-d" class="t-label c2 m0">{{ undoneSets(active) }} {{ undoneSets(active) === 1 ? "set isn't" : "sets aren't" }} ticked off. They're left out.</p>
          <div class="row endacts">
            <button type="button" class="btn secondary t-bodys" @click="confirming = null">Keep going</button>
            <button type="button" class="btn primary t-bodys fill" :disabled="workout.saving" @click="finish(true)">End workout</button>
          </div>
        </template>
        <template v-else>
          <h3 id="wc-h" class="t-bodys m0">Nothing ticked off yet</h3>
          <p id="wc-d" class="t-label c2 m0">Tick off a set to save the workout, or discard it.</p>
          <div class="row endacts">
            <button type="button" class="btn secondary t-bodys" @click="discard"><Icon name="trash" :size="16" /> Discard</button>
            <button type="button" class="btn primary t-bodys fill" @click="confirming = null">Keep going</button>
          </div>
        </template>
      </div>
      <div v-else class="row endacts" data-workout-end>
        <button type="button" class="btn secondary t-bodys" data-workout-discard @click="discard"><Icon name="trash" :size="16" /> Discard</button>
        <button type="button" class="btn primary t-bodys fill" :disabled="workout.saving" data-workout-end-now @click="finish()">
          <span class="tnum">{{ endWhen ? `${endLabel} · ${endWhen}` : endLabel }}</span>
        </button>
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
.confirm { gap: var(--space-xs); }
/* The picker fills the room under the times (if they show), and its pages scroll on their own. */
.addv { gap: var(--space-m); flex: 1 1 auto; min-height: 0; }
/* Discard and End side by side; End takes the room that's left. At XL they stack. */
.row.endacts { gap: var(--space-s); flex-wrap: nowrap; }
.confirm .endacts { padding-top: var(--space-xs); }
.endacts .fill { flex: 1 1 0; min-width: 0; }
html.dt-xl .row.endacts { flex-wrap: wrap; }
html.dt-xl .endacts .btn { flex-basis: 100%; }
.tnum { font-variant-numeric: tabular-nums; }
.empty { padding: var(--space-m); }
/* A superset or circuit: its exercises under one heading, joined by a rail down the left. */
.solo { display: contents; }
/* Warm-up, Workout, Cool-down: a little more room above each, so the parts read apart. */
.part { padding-top: var(--space-s); }
.ss { gap: var(--space-s); padding-left: var(--space-s); border-left: var(--line-rail) solid var(--color-action); }
.more { gap: var(--space-s); padding-top: var(--space-xs); }
.row.unmatched { gap: var(--space-s); flex-wrap: nowrap; align-items: center; }
.dleft { margin: var(--space-s) 0 0; text-align: center; }
.pad { gap: var(--space-s); }
.padacts { gap: var(--space-s); flex-wrap: nowrap; }
.padacts .btn { flex: 1 1 0; }
.pastacts { gap: var(--space-s); flex-wrap: nowrap; }
.pastacts .btn.grow { flex: 1 1 0; }
.body .day.row { flex-wrap: nowrap; gap: var(--space-s); }
.day input { flex: none; background: none; border: 0; color: var(--text-primary); color-scheme: dark; min-height: var(--control-hit); text-align: right; }
.stats { gap: var(--space-s); flex-wrap: nowrap; }
.stat { flex: 1 1 0; min-width: 0; gap: var(--space-2xs); padding: var(--space-m); border-radius: var(--radius-l); background: var(--color-surface-2); }
.dt-xl .stats { flex-wrap: wrap; }
.dt-xl .stat { flex-basis: 100%; }
.done { list-style: none; margin: 0; padding: 0; }
.drow { gap: var(--space-m); padding-block: var(--space-s); border-bottom: 1px solid var(--color-border); align-items: baseline; }
.dname, .dline { min-width: 0; overflow-wrap: anywhere; }
.dline { text-align: right; }
.dname { gap: var(--space-2xs); }
.best { color: var(--color-action); display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.best :deep(svg) { flex: none; align-self: center; }
</style>
