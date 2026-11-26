<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import { todayInZone } from "../lib/dates";
import { dayLabel, projectDays, upNext, weekLine, workoutLine } from "../lib/plan";
import { workoutStatus } from "../lib/workout";
import { loadPlan, plan } from "../state/plan";
import { deviceTimeZone } from "../state/profile";
import { loadHistory, startPlanWorkout, workout, workoutHistory } from "../state/workout";
import { openPlanWorkout, openWorkout } from "../ui";

// Today's training card (docs/training.md, phase 3; Settings → Home sections → Training). It shows the
// workout in progress, today's plan workout, the one done or skipped today, or a rest day. Without a plan
// and with nothing running it stays away.
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  if (plan.state === "idle" || plan.state === "failed") void loadPlan();
  if (workoutHistory.state === "idle" || workoutHistory.state === "failed") void loadHistory();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const today = computed(() => todayInZone(deviceTimeZone(), new Date(now.value)));
const next = computed(() => {
  if (!plan.current) return null;
  return upNext(plan.current, workout.pending.flatMap((draft) => (draft.plan ? [draft.plan] : [])));
});
/** The plan workout done or skipped today, newest first: from the history, or waiting to send. */
const doneToday = computed(() => {
  const ids = new Set(plan.current?.workouts.map((item) => item.id) ?? []);
  const waiting = workout.pending.find((draft) => draft.plan && ids.has(draft.plan.workoutId) && draft.date === today.value);
  if (waiting) return { name: waiting.name ?? "Workout", skipped: false, line: "Waiting to send" };
  const row = workoutHistory.rows.find((item) => item.planWorkoutId != null && ids.has(item.planWorkoutId) && item.date === today.value);
  if (!row) return null;
  const minutes = row.startedAt && row.endedAt ? Math.round((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60_000) : null;
  const line = [minutes != null ? `${minutes} min` : "", `${row.sets} ${row.sets === 1 ? "set" : "sets"}`].filter(Boolean).join(" · ");
  return { name: row.name ?? "Workout", skipped: row.status === "skipped", line };
});
const coming = computed(() => (plan.current && next.value ? projectDays(plan.current, next.value, today.value, !!doneToday.value, 1)[0] ?? null : null));
const nextText = computed(() => (coming.value ? `Next: ${coming.value.workout.name} · ${dayLabel(coming.value.date, today.value)}` : ""));

const state = computed(() => {
  if (workout.active) return "running";
  if (!plan.current || !next.value) return "none";
  if (doneToday.value) return "done";
  return coming.value?.date === today.value ? "today" : "rest";
});

function start() {
  if (!workout.active && next.value) startPlanWorkout(next.value);
  openWorkout();
}
</script>

<template>
  <section v-if="state === 'running'" class="card row tcard" aria-label="Today's workout" data-training-today="running">
    <span class="tdisc" aria-hidden="true"><Icon name="dumbbell" :size="18" :sw="2.2" /></span>
    <span class="col grow ttext">
      <span class="t-bodys">{{ workout.active?.name ?? "Workout" }} in progress</span>
      <span class="t-capn c2">{{ workout.active ? workoutStatus(workout.active, now) : "" }}</span>
    </span>
    <button type="button" class="btn sm primary t-label" @click="openWorkout()"><Icon name="play" :size="14" /> Resume</button>
  </section>

  <section v-else-if="state === 'today' && next" class="card row tcard" aria-label="Today's workout" data-training-today="today">
    <span class="tdisc" aria-hidden="true"><Icon name="dumbbell" :size="18" :sw="2.2" /></span>
    <span class="col grow ttext">
      <span class="t-bodys">{{ next.workout.name }}</span>
      <span class="t-capn c2">{{ workoutLine(next.workout) }}</span>
      <span class="t-capn c2">{{ weekLine(next, plan.current?.blockWeeks ?? 6) }}</span>
    </span>
    <button v-if="!next.workout.exercises.length" type="button" class="btn sm primary t-label" :aria-label="`Add exercises to ${next.workout.name}`" @click="openPlanWorkout(next.workout.id)"><Icon name="plus" :size="14" /> Add</button>
    <button v-else type="button" class="btn sm primary t-label" :aria-label="`Start ${next.workout.name}`" @click="start"><Icon name="play" :size="14" /> Start</button>
  </section>

  <section v-else-if="state === 'done' && doneToday" class="card row tcard" aria-label="Today's workout" data-training-today="done">
    <span class="tdisc" :class="doneToday.skipped ? 'rest' : 'done'" aria-hidden="true"><Icon :name="doneToday.skipped ? 'dumbbell' : 'check'" :size="18" :sw="doneToday.skipped ? 2.2 : 2.6" /></span>
    <span class="col grow ttext">
      <span class="t-bodys">{{ doneToday.name }} · {{ doneToday.skipped ? "skipped" : "done" }}</span>
      <span v-if="!doneToday.skipped" class="t-capn c2">{{ doneToday.line }}</span>
      <span v-if="nextText" class="t-capn c2">{{ nextText }}</span>
    </span>
  </section>

  <section v-else-if="state === 'rest' && next" class="card row tcard" aria-label="Today's workout" data-training-today="rest">
    <span class="tdisc rest" aria-hidden="true"><Icon name="dumbbell" :size="18" :sw="2.2" /></span>
    <span class="col grow ttext">
      <span class="t-bodys">Rest day</span>
      <span class="t-capn c2">{{ nextText }} · ~{{ next.workout.minutes }} min</span>
    </span>
    <button type="button" class="btn sm secondary t-label" :aria-label="`Train anyway: start ${next.workout.name}`" @click="start">Train anyway</button>
  </section>
</template>

<style scoped>
.card.tcard { flex-direction: row; gap: var(--space-m); align-items: center; flex-wrap: nowrap; text-align: left; width: 100%; min-width: 0; }
.ttext { gap: var(--space-2xs); min-width: 0; }
.dt-xl .card.tcard { flex-wrap: wrap; }
.dt-xl .tcard .btn { flex: 1 1 100%; }
</style>
