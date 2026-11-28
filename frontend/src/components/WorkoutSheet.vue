<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import SwapList from "./SwapList.vue";
import Icon from "./Icon.vue";
import WorkoutTimeline from "./WorkoutTimeline.vue";
import WorkoutDescribe from "./WorkoutDescribe.vue";
import WorkoutTimes from "./WorkoutTimes.vue";
import { clockTime, exerciseGroups, exerciseSummary, shortDay, timesLabel, undoneSets, workoutStatus, workoutTotals } from "../lib/workout";
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
  restorePast,
  restoreWorkout,
  savePast,
  workout,
} from "../state/workout";
import { distanceText } from "../lib/cardio";
import { scoreLine } from "../lib/timed";
import { canDescribe } from "../lib/describeWorkout";
import { leftLine, describeLeftShownAt } from "../lib/describe";
import { connection } from "../state/connection";
import { describe, loadDescribe } from "../state/describe";
import { findExercises, resetWorkoutDescribe, workoutDescribe } from "../state/workoutDescribe";
import { closeSheet, toast, toastError, ui } from "../ui";

// The workout being logged (docs/training.md, phase 2), and its summary once finished. Closing the sheet
// keeps the workout going; Train shows it to resume. The workout itself is one timeline (WorkoutTimeline):
// every exercise and set on a rail, each number picked on the wheel. A past workout (opened from the history,
// or logged afterwards) is edited in the same sheet, with Save and Delete instead of End and no rest.
const open = computed(() => ui.sheet === "workout");
const active = computed(() => workout.active);
const past = computed(() => workout.past);
/** What the set tables edit: the past workout when one is open, else the live one. */
const current = computed(() => past.value?.draft ?? active.value);
const pastError = ref("");
const today = computed(() => todayInZone(deviceTimeZone(), new Date(now.value)));
const view = ref<"log" | "add" | "swap" | "describe">("log");
const timeline = ref<InstanceType<typeof WorkoutTimeline> | null>(null);
/** The exercise being swapped, on the swap screen. */
const swapping = ref<{ key: string; exerciseId: string } | null>(null);
/** End's check, in the footer where End was tapped: sets not ticked off, or nothing ticked off at all. */
const confirming = ref<null | "undone" | "empty">(null);
/** The time card, opened from the header's time chip. */
const timesOpen = ref(false);
const waiting = ref(false);

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

/** An exercise added opens on the timeline, in view. */
async function pick(exerciseId: string) {
  const key = await addExercise(exerciseId);
  timesOpen.value = false;
  view.value = "log";
  await nextTick();
  if (key) void timeline.value?.openRun(key);
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
  view.value = "log";
}

function startSwap(exercise: { key: string; exerciseId: string }) {
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
  const name = (id: string) => exerciseItem(id)?.name ?? "Exercise";
  toast(`Swapped ${name(from.exerciseId)} for ${name(exerciseId)}`);
  await nextTick();
  void timeline.value?.openRun(key);
}

/** End now, or at the end set on the time card. Sets not ticked off are left out, after asking. */
async function finish(anyway = false) {
  const current = active.value;
  if (!current || workout.saving) return;
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
}

function discard() {
  const dropped = discardWorkout();
  confirming.value = null;
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
const label = computed(() => (showSummary.value ? "Workout done" : view.value === "add" ? "Add exercise" : view.value === "describe" ? "Describe a workout" : view.value === "swap" ? swapTitle.value : past.value ? pastTitle.value : active.value?.name ?? "Workout"));

function setPastDate(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (past.value && /^\d{4}-\d{2}-\d{2}$/.test(value)) past.value.draft.date = value;
}

async function savePastNow() {
  const error = await savePast();
  pastError.value = error ?? "";
  if (error) return;
  closeSheet();
  toast("Workout saved");
}

async function deletePastNow() {
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
      <div v-else-if="view === 'describe'" class="row hdr">
        <!-- Before the first exercise there is no workout to go back to: ← is Quick add's first page, Add exercise. -->
        <button
          type="button" class="cbtn" :aria-label="fresh ? 'Back to Add exercise' : 'Back to the workout'" @click="view = fresh ? 'add' : 'log'"
        ><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">Describe a workout</h2>
      </div>
      <div v-else-if="view === 'swap'" class="row hdr">
        <button type="button" class="cbtn" aria-label="Back to the workout" @click="view = 'log'"><Icon name="left" :size="18" /></button>
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
      <WorkoutTimeline
        ref="timeline" :exercises="past.draft.exercises" :live="false" :now="now" :started-at="past.draft.startedAt" :day="past.draft.date"
        @add="view = 'add'" @describe="startDescribe" @swap="startSwap"
      />
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
      <WorkoutTimeline
        ref="timeline" :exercises="active.exercises" :live="true" :now="now" :started-at="active.startedAt"
        @add="view = 'add'" @describe="startDescribe" @swap="startSwap"
      />
    </div>

    <template v-if="showSummary" #footer>
      <button type="button" class="btn primary block t-bodys" @click="closeDone">Done</button>
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
.row.unmatched { gap: var(--space-s); flex-wrap: nowrap; align-items: center; }
.dleft { margin: var(--space-s) 0 0; text-align: center; }
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
