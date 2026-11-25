<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "./Icon.vue";
import {
  clockView,
  FORMAT_OPTIONS,
  formatLabel,
  MAX_EVERY,
  MAX_EXTRA_REPS,
  MAX_MINUTES,
  MIN_MINUTES,
  runHeading,
  scoreLine,
  type BlockFormat,
} from "../lib/timed";
import type { DraftExercise } from "../lib/workout";
import { setBlockFormat, startClock, stepBlockEvery, stepBlockMinutes, stepExtraReps, stopClock, tickRound } from "../state/workout";

// A superset or circuit's heading, and its clock when it's done on one (docs/training.md, phase 6): the format
// (Rounds, EMOM, AMRAP, For time), then Start, Round done and Stop while it runs, and the score after.
// `live` is the workout in progress; a past workout shows the format and score, without a clock.
const props = defineProps<{ run: DraftExercise[]; live: boolean; now: number }>();

const head = computed(() => props.run[0]);
const timed = computed(() => head.value.timed ?? null);
const choosing = ref(false);
const view = computed(() => (timed.value ? clockView(timed.value, props.run, props.now) : null));
const running = computed(() => view.value?.phase === "running");
const heading = computed(() => runHeading(timed.value, props.run));
const score = computed(() => (timed.value ? scoreLine(timed.value, props.run) : ""));
/** The format can change until the clock starts. */
const canChange = computed(() => !props.live || !timed.value?.startedAt);
const showScore = computed(() => !!timed.value && (!props.live || view.value?.phase === "over"));

function pick(value: BlockFormat | "rounds") {
  setBlockFormat(head.value.key, value === "rounds" ? null : value);
}

// A buzz as each EMOM round starts, and a longer one when the time is up.
watch(() => (view.value ? [view.value.phase, view.value.round] as const : null), (next, before) => {
  if (!props.live || !next || !before) return;
  if (before[0] === "running" && next[0] === "over") navigator.vibrate?.(400);
  else if (next[0] === "running" && before[0] === "running" && next[1] > before[1]) navigator.vibrate?.(200);
});
watch(() => timed.value?.startedAt, (started) => {
  if (started) choosing.value = false;
});
</script>

<template>
  <div class="row sshead">
    <Icon :name="timed ? 'clock' : 'link'" :size="14" />
    <span class="t-capn c2 grow" data-run-heading>{{ heading }}</span>
    <button
      v-if="canChange" type="button" class="btn sm secondary t-label" :aria-expanded="choosing"
      :aria-label="`Format: ${formatLabel(timed)}. Change`" data-block-format @click="choosing = !choosing"
    >{{ formatLabel(timed) }}</button>
  </div>

  <div v-if="choosing && canChange" class="card inset col tpanel" data-format-panel>
    <div class="row wrap" role="radiogroup" aria-label="Format">
      <button
        v-for="option in FORMAT_OPTIONS" :key="option.value" type="button" role="radio" class="chip t-label"
        :class="{ on: (timed?.format ?? 'rounds') === option.value }" :aria-checked="(timed?.format ?? 'rounds') === option.value" @click="pick(option.value)"
      ><span>{{ option.label }}</span></button>
    </div>
    <template v-if="timed && timed.format !== 'for_time'">
      <div class="row stepper">
        <span class="t-label c2 grow">Minutes</span>
        <span class="row steps">
          <button type="button" class="cbtn" aria-label="A minute less" :disabled="timed.minutes <= Math.max(MIN_MINUTES, timed.format === 'emom' ? timed.every : 1)" @click="stepBlockMinutes(head.key, -1)"><Icon name="minus" :size="16" /></button>
          <span class="t-ns val" aria-live="polite" data-block-minutes>{{ timed.minutes }} min</span>
          <button type="button" class="cbtn" aria-label="A minute more" :disabled="timed.minutes >= MAX_MINUTES" @click="stepBlockMinutes(head.key, 1)"><Icon name="plus" :size="16" /></button>
        </span>
      </div>
      <div v-if="timed.format === 'emom'" class="row stepper">
        <span class="t-label c2 grow">A round every</span>
        <span class="row steps">
          <button type="button" class="cbtn" aria-label="Rounds more often" :disabled="timed.every <= 1" @click="stepBlockEvery(head.key, -1)"><Icon name="minus" :size="16" /></button>
          <span class="t-ns val" aria-live="polite" data-block-every>{{ timed.every }} min</span>
          <button type="button" class="cbtn" aria-label="Rounds less often" :disabled="timed.every >= MAX_EVERY" @click="stepBlockEvery(head.key, 1)"><Icon name="plus" :size="16" /></button>
        </span>
      </div>
    </template>
    <p class="t-capn c2 m0">
      <template v-if="!timed">Rest after each round, as a superset.</template>
      <template v-else-if="timed.format === 'emom'">Each exercise gets a set for every round. Start the clock; it buzzes as each round begins.</template>
      <template v-else-if="timed.format === 'amrap'">Tap Round done after each round; the sets fill in from the last. Add the extra reps at the end.</template>
      <template v-else>A round is one set of each exercise: add or remove sets for more or fewer. The clock stops at the last one.</template>
    </p>
    <button type="button" class="btn sm primary t-label done" @click="choosing = false">Done</button>
  </div>

  <div v-if="live && timed && view && view.phase !== 'over'" class="card inset col tclock" data-block-clock :data-phase="view.phase">
    <div class="row trow">
      <span class="col grow g2">
        <span class="t-capn c2">{{ view.caption }}</span>
        <span class="t-ns" role="timer" aria-live="off" data-block-time>{{ view.time }}</span>
      </span>
      <button v-if="view.phase === 'ready'" type="button" class="btn sm primary t-label" data-block-start @click="startClock(head.key)"><Icon name="play" :size="14" /> Start</button>
      <template v-else-if="running">
        <button type="button" class="btn sm primary t-label" data-round-done @click="tickRound(head.key)">Round done</button>
        <button type="button" class="btn sm secondary t-label" @click="stopClock(head.key)">Stop</button>
      </template>
    </div>
  </div>

  <div v-if="showScore && timed" class="card inset col tclock" data-block-score>
    <span class="col g2">
      <span class="t-capn c2">Score</span>
      <span class="t-bodys" data-block-score-line>{{ score }}</span>
    </span>
    <div v-if="timed.format === 'amrap'" class="row stepper">
      <span class="t-label c2 grow">Extra reps</span>
      <span class="row steps">
        <button type="button" class="cbtn" aria-label="One extra rep less" :disabled="!timed.reps" @click="stepExtraReps(head.key, -1)"><Icon name="minus" :size="16" /></button>
        <span class="t-ns val" aria-live="polite" data-extra-reps>{{ timed.reps ?? 0 }}</span>
        <button type="button" class="cbtn" aria-label="One extra rep more" :disabled="(timed.reps ?? 0) >= MAX_EXTRA_REPS" @click="stepExtraReps(head.key, 1)"><Icon name="plus" :size="16" /></button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
/* .row.* outranks main.css's ".dt-xl .row" wrapping, so the icon stays beside its text at the largest size. */
.row.sshead { gap: var(--space-xs); flex-wrap: nowrap; min-height: var(--control-hit); }
.sshead > :first-child { flex: none; color: var(--text-secondary); }
.sshead > .grow { min-width: 0; }
.tpanel, .tclock { padding: var(--space-m); gap: var(--space-s); }
.wrap { gap: var(--space-xs); flex-wrap: wrap; }
.done { align-self: flex-start; }
/* As the plan workout editor's steppers: at the largest text size the buttons and value move under the label together. */
.stepper { gap: var(--space-s); flex-wrap: wrap; }
.steps { gap: var(--space-s); flex-wrap: nowrap; flex: none; margin-inline-start: auto; }
.val { min-width: calc(var(--control-hit) * 1.6); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.row.trow { gap: var(--space-s); flex-wrap: nowrap; }
.dt-xl .row.trow { flex-wrap: wrap; }
</style>
