<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ExerciseBrowser from "../components/ExerciseBrowser.vue";
import Icon from "../components/Icon.vue";
import OfflineLine from "../components/OfflineLine.vue";
import { todayInZone } from "../lib/dates";
import { dayLabel, nextLine, planLine, projectDays, upNext, weekLine, workoutLine } from "../lib/plan";
import { historyLine, shortDay, workoutStatus, workoutTotals } from "../lib/workout";
import { exercises, loadExercises } from "../state/exercises";
import { loadPlan, plan } from "../state/plan";
import { deviceTimeZone } from "../state/profile";
import { loadHistory, newPast, openPast, skipPlanWorkout, startPlanWorkout, startWorkout, unskipPlanWorkout, workout, workoutHistory } from "../state/workout";
import { openExercise, openPlan, openPlanWorkout, openWorkout, toast, toastError } from "../ui";

// Training (docs/training.md): start or resume a workout, the plan, the history and the exercise library.
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  void loadExercises();
  void loadHistory();
  void loadPlan();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const status = computed(() => (workout.active ? workoutStatus(workout.active, now.value) : ""));

function start() {
  startWorkout();
  openWorkout();
}

// Up next: the plan's next workout, counting finished ones still waiting to send.
const next = computed(() => {
  if (!plan.current) return null;
  const waiting = workout.pending.flatMap((draft) => (draft.plan ? [draft.plan] : []));
  return upNext(plan.current, waiting);
});
/** The live workout is this one: Resume instead of Start, and no Skip. */
const nextRunning = computed(() => !!next.value && workout.active?.plan?.position === next.value.position && workout.active.plan.workoutId === next.value.workout.id);
const skipping = ref(false);

// The calendar: Up next and the ones after it on your coming training days, a week's worth.
const today = computed(() => todayInZone(deviceTimeZone(), new Date(now.value)));
const doneToday = computed(() =>
  workoutHistory.rows.some((row) => row.planWorkoutId != null && row.date === today.value)
  || workout.pending.some((draft) => draft.plan && draft.date === today.value));
const coming = computed(() => (plan.current && next.value ? projectDays(plan.current, next.value, today.value, doneToday.value, plan.current.weekdays.length) : []));
const nextDay = computed(() => (coming.value[0] ? dayLabel(coming.value[0].date, today.value) : ""));

function startNext() {
  if (!next.value) return;
  if (!workout.active) startPlanWorkout(next.value);
  openWorkout();
}

async function skipNext() {
  const current = next.value;
  if (!current || skipping.value) return;
  skipping.value = true;
  const result = await skipPlanWorkout(current);
  skipping.value = false;
  if ("error" in result) {
    toastError(result.error);
    return;
  }
  toast(`Skipped ${current.workout.name}`, {
    label: "Undo",
    run: () => {
      void unskipPlanWorkout(result.id).then((ok) => { if (!ok) toastError("Couldn't undo the skip. Try again when you're online."); });
    },
  });
}

// History: the last year, ten at a time. Finished workouts still waiting to send show first.
const shown = ref(10);
const nameOf = (id: string) => exercises.items.find((item) => item.id === id)?.name ?? id;
const waitingRows = computed(() => workout.pending.map((draft) => ({
  id: draft.id,
  date: draft.date,
  line: historyLine({ exercises: draft.exercises.map((exercise) => exercise.exerciseId), ...totalsOf(draft) }, nameOf),
})));
function totalsOf(draft: (typeof workout.pending)[number]) {
  const totals = workoutTotals(draft);
  return { sets: totals.sets, volumeKg: totals.volumeKg, metres: totals.metres };
}
const rows = computed(() => workoutHistory.rows.slice(0, shown.value));

async function openRow(id: string) {
  if (await openPast(id)) openWorkout();
  else toastError("That workout needs a connection to open.");
}

function logPast() {
  newPast();
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

    <section v-if="plan.current" class="card" aria-labelledby="plan-title" data-plan-card>
      <div class="chead">
        <h2 id="plan-title" class="t-head section-title grow">Plan</h2>
        <button type="button" class="btn sm secondary t-label" @click="openPlan()">Edit</button>
      </div>
      <span class="t-body">{{ planLine(plan.current) }}</span>
      <div v-if="next" class="well col g8 upnext" data-up-next :data-position="next.position">
        <span class="t-cap c3 section-title">Up next<template v-if="nextDay"> · {{ nextDay }}</template></span>
        <span class="col g2">
          <span class="t-bodys">{{ next.workout.name }}</span>
          <span class="t-label c2">{{ nextLine(next) }}</span>
          <span class="t-label c2">{{ weekLine(next, plan.current.blockWeeks) }}</span>
        </span>
        <p v-if="workout.active && !nextRunning" class="t-capn c2 m0">Finish the workout in progress to start this one.</p>
        <div class="row g8 nbtns">
          <span v-if="nextRunning" class="t-label c2" data-up-next-running>In progress</span>
          <button v-else-if="!next.workout.exercises.length" type="button" class="btn sm primary t-label" :aria-label="`Add exercises to ${next.workout.name}`" data-up-next-fill @click="openPlanWorkout(next.workout.id)"><Icon name="plus" :size="14" /> Add exercises</button>
          <button v-else-if="!workout.active" type="button" class="btn sm primary t-label" :aria-label="`Start ${next.workout.name}`" @click="startNext"><Icon name="play" :size="14" /> Start</button>
          <button v-if="!nextRunning" type="button" class="btn sm secondary t-label" :aria-label="`Skip ${next.workout.name}`" :disabled="skipping" @click="skipNext">Skip</button>
        </div>
        <ul v-if="coming.length > 1" class="list col then" aria-label="Then" data-plan-coming>
          <li v-for="day in coming.slice(1)" :key="day.position" class="row trow" :data-date="day.date">
            <span class="t-label grow">{{ day.workout.name }}</span>
            <span class="t-label c2">{{ dayLabel(day.date, today) }}</span>
          </li>
        </ul>
      </div>
      <ol class="list pws">
        <li v-for="item in plan.current.workouts" :key="item.id" :data-plan-workout="item.name" :aria-current="next?.workout.id === item.id ? 'step' : undefined">
          <button type="button" class="row pw" :aria-label="`Edit ${item.name}, ${workoutLine(item)}${item.edited ? ', edited by you' : ''}`" @click="openPlanWorkout(item.id)">
            <span class="col grow pwtext">
              <span class="row pwhead"><span class="t-bodys grow">{{ item.name }}</span><span class="t-label c2">{{ workoutLine(item) }}</span></span>
              <span class="t-capn c2">{{ item.exercises.map((exercise) => nameOf(exercise.exerciseId)).join(" · ") }}</span>
              <span v-if="item.edited" class="t-capn c3" data-plan-edited>Edited by you</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
        </li>
      </ol>
    </section>
    <section v-else-if="plan.state === 'ready'" class="card" aria-labelledby="plan-title" data-plan-card>
      <span class="col g2">
        <h2 id="plan-title" class="t-head m0">Plan</h2>
        <span class="t-capn c2">Answer a few questions and get workouts that fit your week and your time, or build your own.</span>
      </span>
      <div class="row g8 mkbtns">
        <button type="button" class="btn secondary t-label" @click="openPlan()">Make a plan</button>
        <button type="button" class="btn secondary t-label" data-build-own @click="openPlan(true)">Build your own</button>
      </div>
    </section>

    <section class="col hist" aria-labelledby="history-title" data-workout-history>
      <div class="chead">
        <h2 id="history-title" class="t-cap c3 section-title grow">History</h2>
        <button type="button" class="btn sm secondary t-label" @click="logPast"><Icon name="plus" :size="14" /> Log past</button>
      </div>
      <ul v-if="waitingRows.length || rows.length" class="list">
        <li v-for="row in waitingRows" :key="row.id" class="row hrow waiting">
          <span class="col grow text">
            <span class="t-body">{{ shortDay(row.date) }} <span class="t-label c2">· waiting</span></span>
            <span class="t-label c2 line">{{ row.line }}</span>
          </span>
        </li>
        <li v-for="row in rows" :key="row.id">
          <button type="button" class="row hrow" :data-workout-row="row.id" @click="openRow(row.id)">
            <span class="col grow text">
              <span class="t-body">{{ row.name ?? shortDay(row.date) }}<span v-if="row.name" class="t-label c2"> · {{ shortDay(row.date) }}</span></span>
              <span class="t-label c2 line">{{ historyLine(row, nameOf) }}</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
        </li>
      </ul>
      <p v-else-if="workoutHistory.state === 'loading' || workoutHistory.state === 'idle'" class="t-label c2 m0 note">Loading workouts…</p>
      <div v-else-if="workoutHistory.state === 'failed'" class="row note">
        <span class="t-label c2 grow">Couldn't load your workouts.</span>
        <button type="button" class="btn sm secondary t-label" @click="loadHistory">Try again</button>
      </div>
      <p v-else class="t-label c2 m0 note">No workouts yet. Finished ones show here, newest first.</p>
      <button v-if="workoutHistory.rows.length > shown" type="button" class="btn sm secondary t-label more" @click="shown += 10">Show more</button>
    </section>

    <ExerciseBrowser title="Exercises" title-id="exercises-title" @pick="openExercise" />
  </main>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.wrow { gap: var(--space-m); }
.dt-xl .wrow .btn { flex: 1 1 100%; }
.pws { display: flex; flex-direction: column; }
.pw {
  width: 100%; min-height: var(--control-hit); gap: var(--space-m); padding: var(--space-s) 0; flex-wrap: nowrap;
  background: none; border: 0; color: inherit; text-align: left;
}
.pws li + li .pw { border-top: 1px solid var(--color-border); }
.pwtext { gap: var(--space-2xs); min-width: 0; }
.pwhead { gap: var(--space-s); }
.g8 { gap: var(--space-s); }
.nbtns { flex-wrap: wrap; }
.mkbtns { flex-wrap: wrap; }
.dt-xl .mkbtns .btn { flex: 1 1 100%; }
.then { border-top: 1px solid var(--color-border); padding-top: var(--space-xs); }
.trow { gap: var(--space-s); padding-block: var(--space-2xs); }
.hist { gap: var(--space-s); }
.hist .chead { padding-top: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; }
.hrow {
  width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0; flex-wrap: nowrap;
  background: none; border: 0; border-bottom: 1px solid var(--color-border); color: inherit; text-align: left;
}
.text { gap: var(--space-2xs); min-width: 0; }
.line { overflow-wrap: anywhere; }
.note { padding-block: var(--space-m); gap: var(--space-s); }
.more { align-self: flex-start; }
</style>
