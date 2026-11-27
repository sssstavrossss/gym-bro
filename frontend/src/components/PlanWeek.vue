<script setup lang="ts">
import { computed } from "vue";
import { blockNote, dayNames, eachMinutes, mobilityLine, splitLabel, WEEKDAYS, workoutDays, workoutLine, type PlanPreview } from "../lib/plan";
import { exercises } from "../state/exercises";

// What a plan makes, before it starts: its split and block, the week, and each workout with its days and exercises.
// New plan and Explore → Plans show it.
const props = defineProps<{ preview: PlanPreview; weekdays: number[]; minutes: number }>();

const nameOf = (id: string) => exercises.items.find((item) => item.id === id)?.name ?? id;
const days = computed(() => workoutDays(props.weekdays, props.preview.workouts.length));
const week = computed(() => WEEKDAYS.map((day, index) => {
  const at = days.value.findIndex((list) => list.includes(index));
  const name = at >= 0 ? props.preview.workouts[at]?.name : undefined;
  return { day, letter: day[0], name, label: name ? `${day}, ${name}` : `${day}, rest day` };
}));
</script>

<template>
  <div class="col g16">
    <dl class="gstats">
      <div><dt class="t-capn c2">Split</dt><dd class="t-bodys">{{ splitLabel(preview.split) }}</dd></div>
      <div><dt class="t-capn c2">Block</dt><dd class="t-bodys">{{ preview.blockWeeks }} weeks</dd></div>
      <div><dt class="t-capn c2">Each</dt><dd class="t-bodys">~{{ eachMinutes(preview.workouts, minutes) }} min</dd></div>
    </dl>
    <ol class="wkstrip" aria-label="Your week" data-plan-week>
      <li v-for="day in week" :key="day.day" class="wkday" :data-state="day.name ? 'planned' : 'rest'">
        <span class="wkdisc t-bodys" aria-hidden="true">{{ day.letter }}</span>
        <span class="sr-only">{{ day.label }}</span>
      </li>
    </ol>
    <ol class="list nws">
      <li v-for="(item, at) in preview.workouts" :key="item.id" class="col nw" :data-plan-new-workout="item.name">
        <span class="row pwhead"><span class="t-bodys grow">{{ item.name }}</span><span class="t-label c2">{{ workoutLine(item) }}</span></span>
        <span class="t-capn c2">{{ days[at]?.length ? dayNames(days[at]) : "From week 2" }}</span>
        <span v-if="item.exercises.length" class="t-capn c3 names">{{ item.exercises.map((exercise) => nameOf(exercise.exerciseId)).join(" · ") }}</span>
        <span v-if="mobilityLine(item)" class="t-capn c3">{{ mobilityLine(item) }}</span>
      </li>
    </ol>
    <p class="t-capn c2 m0" data-plan-block-note>{{ blockNote(preview) }}</p>
  </div>
</template>

<style scoped>
.m0 { margin: 0; }
.g16 { gap: var(--space-m); }
.list { list-style: none; margin: 0; padding: 0; }
/* The workouts, one under the other with a line between. */
.nws { display: flex; flex-direction: column; }
.nw { gap: var(--space-2xs); padding: var(--space-s) 0; min-width: 0; }
.nws > li + li { border-top: 1px solid var(--color-border); }
.row.pwhead { gap: 0 var(--space-s); flex-wrap: wrap; }
.pwhead > .grow { flex-shrink: 0; }
.names { overflow-wrap: anywhere; }
</style>
