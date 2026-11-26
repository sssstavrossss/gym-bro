<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "../components/Icon.vue";
import OfflineLine from "../components/OfflineLine.vue";
import { todayInZone } from "../lib/dates";
import { EXERCISE_AREAS } from "../lib/exercises";
import { dayLabel, mobilityLine, nextLine, planLine, projectDays, upNext, weekLine, workoutLine } from "../lib/plan";
import { lastWorkout, repeatName, startText, trainCards, weekDiscs } from "../lib/train";
import { historyLine, shortDay, workoutStatus, workoutTotals } from "../lib/workout";
import { describe, loadDescribe } from "../state/describe";
import { exercises, loadExercises } from "../state/exercises";
import { loadPlan, plan } from "../state/plan";
import { deviceTimeZone } from "../state/profile";
import { loadHistory, newPast, openPast, repeatWorkout, skipPlanWorkout, startPlanWorkout, startWorkout, unskipPlanWorkout, workout, workoutHistory } from "../state/workout";
import { openExercises, openPlan, openPlanWorkout, openWorkout, toast, toastError } from "../ui";

// Training (docs/training.md): start or resume a workout, the plan and the history. The exercise library is its own
// sheet behind the search button; the list still loads here, for the names on the plan and in history.
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  void loadExercises();
  void loadHistory();
  void loadPlan();
  void loadDescribe();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const status = computed(() => (workout.active ? workoutStatus(workout.active, now.value) : ""));

function start() {
  startWorkout();
  openWorkout();
}

/** Starts a workout on Describe a workout: type what you did or will do, and the exercises are found. */
function startDescribed() {
  startWorkout();
  openWorkout("describe");
}

const cards = computed(() => trainCards({
  active: !!workout.active,
  planState: plan.state,
  hasPlan: !!plan.current,
  historyState: workoutHistory.state,
  historyRows: workoutHistory.rows.length,
  waiting: workout.pending.length,
}));
// Repeat: the last workout done, again, off the plan.
const again = computed(() => lastWorkout(workout.pending, workoutHistory.rows));
const startCopy = computed(() => startText(!!plan.current, describe.available, again.value));
const repeating = ref(false);
async function repeat() {
  if (!again.value || repeating.value) return;
  repeating.value = true;
  await repeatWorkout(again.value);
  repeating.value = false;
  openWorkout();
}
const areas = EXERCISE_AREAS.filter((area) => area.id !== "all");

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
// This week under Up next: days trained, skipped, today and the plan's coming days.
const week = computed(() => {
  const done = [...workoutHistory.rows.filter((row) => row.status === "done").map((row) => row.date), ...workout.pending.map((draft) => draft.date)];
  const skipped = workoutHistory.rows.filter((row) => row.status === "skipped").map((row) => row.date);
  return weekDiscs(today.value, coming.value, done, skipped);
});

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
      <h1 class="t-title grow">Train</h1>
      <button type="button" class="cbtn hbtn" aria-label="Exercises" data-open-exercises @click="openExercises('all', true)"><Icon name="search" :size="18" /></button>
    </header>
    <OfflineLine />

    <!-- A workout going on: the Home training card's look, with Resume. -->
    <section v-if="cards.inProgress" class="card prompt row" aria-labelledby="workout-title" data-workout-card>
      <span class="tdisc" aria-hidden="true"><Icon name="dumbbell" :size="18" :sw="2.2" /></span>
      <span class="col grow g2">
        <h2 id="workout-title" class="t-bodys m0">{{ workout.active?.name ?? "Workout" }} in progress</h2>
        <span class="t-capn c2">{{ status }}</span>
      </span>
      <button type="button" class="btn sm primary t-label" @click="openWorkout()"><Icon name="play" :size="14" /> Resume</button>
    </section>

    <!-- Up next: the plan's next workout, with this week above it. -->
    <section v-if="plan.current && next" class="card" aria-labelledby="next-title" data-up-next :data-position="next.position">
      <div class="row thead">
        <h2 id="next-title" class="section-title c2 grow m0">Up next</h2>
        <span v-if="nextDay" class="t-capn c3" data-next-day>{{ nextDay }}</span>
      </div>
      <ol class="wk" aria-label="This week" data-week>
        <li v-for="day in week" :key="day.date" class="wday" :data-state="day.state" :data-date="day.date">
          <span class="t-cap c3" aria-hidden="true">{{ day.letter }}</span>
          <span class="wdisc t-bodys" aria-hidden="true"><Icon v-if="day.state === 'done'" name="check" :size="16" :sw="2.6" /><template v-else>{{ day.number }}</template></span>
          <span class="sr-only">{{ day.label }}</span>
        </li>
      </ol>
      <span class="col g2">
        <span class="t-bodys">{{ next.workout.name }}</span>
        <span class="t-capn c2">{{ nextLine(next) }}</span>
        <span class="t-capn c2">{{ weekLine(next, plan.current.blockWeeks) }}</span>
        <span v-if="next.workout.exercises.length" class="t-capn c3 names">{{ next.workout.exercises.map((exercise) => nameOf(exercise.exerciseId)).join(" · ") }}</span>
      </span>
      <p v-if="workout.active && !nextRunning" class="t-capn c2 m0">Finish the workout in progress to start this one.</p>
      <div class="row g8 nbtns">
        <span v-if="nextRunning" class="t-label c2" data-up-next-running>In progress</span>
        <button v-else-if="!next.workout.exercises.length" type="button" class="btn sm primary t-label" :aria-label="`Add exercises to ${next.workout.name}`" data-up-next-fill @click="openPlanWorkout(next.workout.id)"><Icon name="plus" :size="14" /> Add exercises</button>
        <button v-else-if="!workout.active" type="button" class="btn sm primary t-label" :aria-label="`Start ${next.workout.name}`" @click="startNext"><Icon name="play" :size="14" /> Start</button>
        <button v-if="!nextRunning" type="button" class="btn sm secondary t-label" :aria-label="`Skip ${next.workout.name}`" :disabled="skipping" @click="skipNext">Skip</button>
      </div>
    </section>

    <!-- Start one now: empty, described in words, or the last one again. Home's "Log your first food today" shape. -->
    <div v-if="cards.start" class="card prompt row" data-start-workout>
      <button type="button" class="ptext col grow" @click="start">
        <span class="t-bodys">{{ startCopy.title }}</span>
        <span class="t-capn c2">{{ startCopy.caption }}</span>
      </button>
      <span class="apill" role="group" :aria-label="startCopy.title">
        <button type="button" aria-label="Empty workout" data-start-empty @click="start"><Icon name="plus" :size="16" :sw="2.6" /></button>
        <button v-if="describe.available" type="button" aria-label="Describe a workout" data-start-describe @click="startDescribed"><Icon name="sparkle" :size="16" /></button>
        <button v-if="again" type="button" :aria-label="`Repeat ${repeatName(again)}`" :disabled="repeating" data-start-repeat @click="repeat"><Icon name="refresh" :size="16" /></button>
      </span>
    </div>

    <section v-if="plan.current" class="card" aria-labelledby="plan-title" data-plan-card>
      <div class="row thead">
        <span class="col grow g2">
          <h2 id="plan-title" class="section-title c2 m0">Your plan</h2>
          <span class="t-capn c2">{{ planLine(plan.current) }}</span>
        </span>
        <button type="button" class="btn sm secondary t-label" @click="openPlan()">Edit</button>
      </div>
      <ol class="list pws">
        <li v-for="item in plan.current.workouts" :key="item.id" :data-plan-workout="item.name" :aria-current="next?.workout.id === item.id ? 'step' : undefined">
          <button type="button" class="row pw" :aria-label="`Edit ${item.name}, ${workoutLine(item)}${item.edited ? ', edited by you' : ''}`" @click="openPlanWorkout(item.id)">
            <span class="col grow pwtext">
              <span class="row pwhead"><span class="t-bodys grow">{{ item.name }}</span><span class="t-label c2">{{ workoutLine(item) }}</span></span>
              <span class="t-capn c2">{{ item.exercises.map((exercise) => nameOf(exercise.exerciseId)).join(" · ") }}</span>
              <span v-if="mobilityLine(item)" class="t-capn c2" data-plan-mobility>{{ mobilityLine(item) }}</span>
              <span v-if="item.edited" class="t-capn c3" data-plan-edited>Edited by you</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
        </li>
      </ol>
    </section>
    <section v-else-if="cards.makePlan" class="card" aria-labelledby="plan-title" data-plan-card>
      <h2 id="plan-title" class="section-title c2 m0">Make a plan</h2>
      <span class="t-label c2">Answer a few questions. You get workouts that fit your days and your time, and they get harder week by week.</span>
      <div class="row g8 mkbtns">
        <button type="button" class="btn sm primary t-label" @click="openPlan()">Make a plan</button>
        <button type="button" class="btn sm secondary t-label" data-build-own @click="openPlan(true)">Build your own</button>
      </div>
    </section>

    <!-- New here: look around the library first. -->
    <section v-if="cards.explore" class="card" aria-labelledby="explore-title" data-explore>
      <h2 id="explore-title" class="section-title c2 m0">Explore</h2>
      <button type="button" class="row xrow" data-explore-exercises @click="openExercises()">
        <span class="tdisc" aria-hidden="true"><Icon name="dumbbell" :size="18" :sw="2.2" /></span>
        <span class="col grow g2">
          <span class="t-bodys">Exercises</span>
          <span class="t-capn c2">{{ exercises.state === "ready" ? `${exercises.items.length} with photos and how-tos` : "With photos and how-tos" }}</span>
        </span>
        <Icon name="right" :size="16" class="c3" />
      </button>
      <div class="xareas" role="group" aria-label="Exercises by body area">
        <button v-for="area in areas" :key="area.id" type="button" class="chip t-label" :data-explore-area="area.id" @click="openExercises(area.id)">{{ area.label }}</button>
      </div>
    </section>

    <!-- Nothing logged yet: bring in what you did before. -->
    <div v-if="cards.trainedBefore" class="card prompt row" data-trained-before>
      <span class="col grow g2">
        <span class="t-bodys">Trained before?</span>
        <span class="t-capn c2">Log past workouts, so weight suggestions and new bests start from them</span>
      </span>
      <button type="button" class="btn sm secondary t-label" @click="logPast"><Icon name="plus" :size="14" /> Log past</button>
    </div>

    <section v-if="cards.history" class="card" aria-labelledby="history-title" data-workout-history>
      <div class="chead">
        <h2 id="history-title" class="section-title c2 grow">History</h2>
        <button type="button" class="btn sm secondary t-label" @click="logPast"><Icon name="plus" :size="14" /> Log past</button>
      </div>
      <p v-if="workout.pending.length" class="t-capn c2 m0" role="status">
        {{ workout.pending.length === 1 ? "1 workout is" : `${workout.pending.length} workouts are` }} waiting to send. They go when you're back online.
      </p>
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
      <div v-else-if="workoutHistory.state === 'failed'" class="row note">
        <span class="t-label c2 grow">Couldn't load your workouts.</span>
        <button type="button" class="btn sm secondary t-label" @click="loadHistory">Try again</button>
      </div>
      <button v-if="workoutHistory.rows.length > shown" type="button" class="btn sm secondary t-label more" @click="shown += 10">Show more</button>
    </section>
  </main>
</template>

<style scoped>
.m0 { margin: 0; }
/* Profile's header buttons: grey, and the last one's face lines up with the cards' edge. */
.hbtn { color: var(--text-secondary); }
.hbtn:last-child { margin-right: calc((var(--control-s) - var(--control-hit)) / 2); }
.g2 { gap: var(--space-2xs); min-width: 0; }
.dt-xl .card.prompt { flex-wrap: wrap; }
/* At XL the library row keeps its disc beside the words; only the words wrap. */
.dt-xl .xrow { flex-wrap: nowrap; }
/* Explore: a library row, then its body areas as chips that open it there. */
.xrow { width: 100%; min-height: 56px; gap: var(--space-m); padding: 0; background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.xareas { display: flex; flex-wrap: wrap; column-gap: var(--space-xs); margin-block: calc((var(--control-hit) - var(--control-chip)) / -2); }
.pws { display: flex; flex-direction: column; }
.pw {
  width: 100%; min-height: var(--control-hit); gap: var(--space-m); padding: var(--space-s) 0; flex-wrap: nowrap;
  background: none; border: 0; color: inherit; text-align: left;
}
.pws li + li .pw { border-top: 1px solid var(--color-border); }
.pwtext { gap: var(--space-2xs); min-width: 0; }
/* The name keeps its line; a long summary (a finisher's "+ EMOM 10 min") goes under it rather than squeezing it. */
.row.pwhead { gap: 0 var(--space-s); flex-wrap: wrap; }
.pwhead > .grow { flex-shrink: 0; }
.g8 { gap: var(--space-s); }
.nbtns { flex-wrap: wrap; }
.mkbtns { flex-wrap: wrap; }
.dt-xl .mkbtns .btn { flex: 1 1 100%; }
.thead { gap: var(--space-s); flex-wrap: nowrap; }
.names { overflow-wrap: anywhere; }
/* This week: Home's week strip, read-only. A tick for a day trained, a ring for today, a disc for a plan day. */
.wk { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); justify-items: center; list-style: none; margin: 0; padding: 0; }
.wday { display: flex; flex-direction: column; align-items: center; gap: var(--space-2xs); }
.wdisc {
  width: 36px; height: 36px; border-radius: var(--radius-pill); display: flex; align-items: center; justify-content: center;
  font-size: min(0.8824rem, 20px); line-height: 1; color: var(--text-tertiary);
}
.wday[data-state="done"] .wdisc { background: var(--color-action); color: var(--color-on-action); box-shadow: var(--d-action); }
.wday[data-state="today"] .wdisc { box-shadow: inset 0 0 0 2px var(--color-action); color: var(--color-action); }
.wday[data-state="planned"] .wdisc { background: var(--color-surface-2); box-shadow: var(--d-edge); color: var(--text-primary); }
.wday[data-state="skipped"] .wdisc { text-decoration: line-through; }
.list { list-style: none; margin: 0; padding: 0; }
.hrow {
  width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0; flex-wrap: nowrap;
  background: none; border: 0; border-bottom: 1px solid var(--color-border); color: inherit; text-align: left;
}
.list > li:last-child > .hrow, .list > li.hrow:last-child { border-bottom: 0; }
.text { gap: var(--space-2xs); min-width: 0; }
.line { overflow-wrap: anywhere; }
.note { padding-block: var(--space-m); gap: var(--space-s); }
.more { align-self: flex-start; }
</style>
