<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "../components/Icon.vue";
import OfflineLine from "../components/OfflineLine.vue";
import Segmented from "../components/Segmented.vue";
import { todayInZone } from "../lib/dates";
import { EXERCISE_AREAS } from "../lib/exercises";
import { dayLabel, GOALS, mobilityLine, nextLine, PLAN_KINDS, planLine, projectDays, splitFor, splitLabel, toggled, upNext, WEEKDAYS, weekLine, workoutLine } from "../lib/plan";
import { usingLine } from "../lib/training";
import { lastWorkout, repeatName, startText, trainCards, weekDiscs } from "../lib/train";
import { historyLine, shortDay, workoutStatus, workoutTotals } from "../lib/workout";
import { describe, loadDescribe } from "../state/describe";
import { exercises, loadExercises } from "../state/exercises";
import { loadPlan, plan, planDraft } from "../state/plan";
import { training } from "../state/training";
import { deviceTimeZone } from "../state/profile";
import { loadHistory, newPast, openPast, repeatWorkout, skipPlanWorkout, startPlanWorkout, startWorkout, unskipPlanWorkout, workout, workoutHistory } from "../state/workout";
import { openExercises, openImport, openPlan, openPlans, openPlanWorkout, openTraining, openWorkout, toast, toastError } from "../ui";

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

// Make a plan: the split follows the goal and the days. A plan needs a day, so the last one stays on.
const draftSplit = computed(() => splitFor(planDraft.weekdays.length, planDraft.goal));
function toggleDay(day: number) {
  const next = toggled(planDraft.weekdays, day, [0, 1, 2, 3, 4, 5, 6]);
  if (next.length) planDraft.weekdays = next;
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
      <ol class="wkstrip" aria-label="This week" data-week>
        <li v-for="day in week" :key="day.date" class="wkday" :data-state="day.state" :data-date="day.date">
          <span class="t-cap c3" aria-hidden="true">{{ day.letter }}</span>
          <span class="wkdisc t-bodys" aria-hidden="true"><Icon v-if="day.state === 'done'" name="check" :size="16" :sw="2.6" /><template v-else>{{ day.number }}</template></span>
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
    <!-- Make a plan: goal and days here, the rest from Your training. See my plan shows it before it starts. -->
    <section v-else-if="cards.makePlan" class="card" aria-labelledby="plan-title" data-plan-card>
      <div class="row thead">
        <h2 id="plan-title" class="section-title c2 grow m0">Make a plan</h2>
        <span class="t-capn c3">Gets harder week by week</span>
      </div>
      <Segmented v-model="planDraft.goal" size="compact" class="full" label="Goal" :options="GOALS" />
      <div class="dpick" role="group" aria-label="Days you train" data-plan-days>
        <button
          v-for="(day, index) in WEEKDAYS" :key="day" type="button" class="dbtn" :aria-pressed="planDraft.weekdays.includes(index)" :aria-label="day"
          @click="toggleDay(index)"
        ><span class="t-label">{{ day[0] }}</span></button>
      </div>
      <dl class="gstats" data-plan-stats>
        <div><dt class="t-capn c2">Split</dt><dd class="t-bodys">{{ splitLabel(draftSplit) }}</dd></div>
        <div><dt class="t-capn c2">Each week</dt><dd class="t-bodys">{{ planDraft.weekdays.length === 1 ? "1 workout" : `${planDraft.weekdays.length} workouts` }}</dd></div>
        <div><dt class="t-capn c2">Each</dt><dd class="t-bodys">{{ training.minutes }} min</dd></div>
      </dl>
      <button type="button" class="row using" :aria-label="`Your training: ${usingLine(training)}. Change`" data-plan-using @click="openTraining">
        <Icon name="user" :size="16" class="c2" />
        <span class="t-label c2 grow">{{ usingLine(training) }}</span>
        <Icon name="edit" :size="14" class="c3" />
      </button>
      <div class="row g8 mkbtns">
        <button type="button" class="btn sm primary t-label" data-see-plan @click="openPlan()">See my plan</button>
        <button type="button" class="btn sm secondary t-label" data-build-own @click="openPlan('custom')">Build your own</button>
      </div>
    </section>

    <!-- New here: look around the library first. -->
    <section v-if="cards.explore" class="card" aria-labelledby="explore-title" data-explore>
      <h2 id="explore-title" class="section-title c2 m0">Explore</h2>
      <button type="button" class="row xrow" data-explore-plans @click="openPlans">
        <span class="tdisc" aria-hidden="true"><Icon name="layers" :size="18" /></span>
        <span class="col grow g2">
          <span class="t-bodys">Plans</span>
          <span class="t-capn c2">{{ PLAN_KINDS.length }} kinds, with a week of each to look at</span>
        </span>
        <Icon name="right" :size="16" class="c3" />
      </button>
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
    <section v-if="cards.trainedBefore" class="card" aria-labelledby="trained-before-title" data-trained-before>
      <span class="col g2">
        <h2 id="trained-before-title" class="t-bodys m0">Trained before?</h2>
        <span class="t-capn c2">Bring your history, so loads and new bests start from it</span>
      </span>
      <div class="row acts">
        <button type="button" class="btn sm secondary t-label" data-import-open @click="openImport"><Icon name="download" :size="14" /> Import from Strong or Hevy</button>
        <button type="button" class="btn sm secondary t-label" @click="logPast"><Icon name="plus" :size="14" /> Log past</button>
      </div>
    </section>

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
.acts { gap: var(--space-s); flex-wrap: wrap; }
/* At XL each action takes the width, and a long one wraps inside its pill. */
.dt-xl .acts .btn { flex: 1 1 100%; max-width: 100%; }
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
/* Your training, in a line you can tap to change it. */
.using { width: 100%; min-height: var(--control-hit); gap: var(--space-s); padding: 0; background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.using .grow { min-width: 0; overflow-wrap: anywhere; }
/* At XL the icons stay beside the words; only the words wrap. */
.dt-xl .using { flex-wrap: nowrap; }
.names { overflow-wrap: anywhere; }
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
