<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Segmented from "./Segmented.vue";
import { atLocal, clockTime, localDay, timesProblem } from "../lib/workout";
import { quickTimes, setWorkoutTimes, workout } from "../state/workout";

// The live workout's times, opened from the header's time chip: when it started (the day and the time) and
// whether it is still going or ended at a time. A quick workout starts "now"; moving the start back logs one done
// earlier, and an end makes End save it as ending then. On Add exercise before any workout exists (Describe opened
// from Train), the times wait in `quickTimes` and the first exercise starts it with them.
const props = defineProps<{ now: number }>();
const active = computed(() => workout.active ?? quickTimes);

const startDay = ref("");
const startTime = ref("");
const ends = ref<"going" | "at">("going");
const endTime = ref("");
const problem = ref("");

function fill() {
  const current = active.value;
  const started = current.startedAt ?? new Date(props.now).toISOString();
  startDay.value = localDay(started);
  startTime.value = clockTime(started);
  ends.value = current.endedAt ? "at" : "going";
  endTime.value = current.endedAt ? clockTime(current.endedAt) : clockTime(props.now);
  problem.value = "";
}
fill();
watch(() => workout.active?.id, fill);

/** The end is on the start's day, or the next one when its time is earlier (a workout past midnight). */
function endStamp(start: string): string | null {
  const end = atLocal(startDay.value, endTime.value);
  if (!end) return null;
  return Date.parse(end) < Date.parse(start) ? new Date(Date.parse(end) + 86_400_000).toISOString() : end;
}

/** Keeps what was typed when it makes sense; otherwise says why (unless `quiet`) and leaves the workout as it was. */
function apply(quiet = false) {
  const start = atLocal(startDay.value, startTime.value);
  if (!start) return;
  const end = ends.value === "at" ? endStamp(start) : null;
  if (ends.value === "at" && !end) return;
  const why = timesProblem(start, end, Date.now());
  problem.value = quiet ? "" : why ?? "";
  if (!why) setWorkoutTimes(start, end);
}

function setEnds(value: "going" | "at") {
  ends.value = value;
  if (value === "at" && !endTime.value) endTime.value = clockTime(Date.now());
  // Picking "At a time" offers now as the end; it is only questioned once a time is typed.
  apply(value === "at");
}

const today = computed(() => localDay(props.now));
const ENDS = [{ value: "going" as const, label: "Still going" }, { value: "at" as const, label: "At a time" }];
</script>

<template>
  <section v-if="active" class="card outline col times" aria-label="Times" data-workout-times>
    <div class="col g4">
      <span class="t-label c2">Started</span>
      <div class="row tins">
        <input v-model="startDay" class="field t-body tin" type="date" :max="today" min="2000-01-01" aria-label="Day it started" data-no-autofocus data-start-day @change="apply()" />
        <input v-model="startTime" class="field t-body tin" type="time" aria-label="Time it started" data-no-autofocus data-start-time @change="apply()" />
      </div>
    </div>
    <div class="row trow">
      <span class="t-body c2 grow">Ends</span>
      <Segmented :model-value="ends" size="compact" label="Ends" :options="ENDS" @update:model-value="setEnds" />
    </div>
    <div v-if="ends === 'at'" class="row trow">
      <span class="t-body c2 grow">Ended</span>
      <input v-model="endTime" class="field t-body tin end" type="time" aria-label="Time it ended" data-no-autofocus data-end-time @change="apply()" />
    </div>
    <p v-if="problem" class="t-label m0" role="alert" data-times-problem>{{ problem }}</p>
    <p v-else class="t-capn c2 m0">Did it earlier? Move the start back, and set when it ended.</p>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.times { gap: var(--space-s); padding: var(--space-m); }
/* The large text sizes wrap every .row (main.css); a label and its fields stay on one line. */
.row.trow { gap: var(--space-s); flex-wrap: nowrap; min-height: var(--control-hit); }
.g4 { gap: var(--space-2xs); }
/* The day and the time share the card's width; a date field is wide in some browsers, so they get a row of their own. */
.row.tins { gap: var(--space-s); flex-wrap: nowrap; }
.tin { flex: 1 1 0; min-width: 0; width: auto; color-scheme: dark; font-variant-numeric: tabular-nums; }
.tin.end { flex: 0 1 50%; }
html.dt-xl .row.trow { flex-wrap: wrap; }
</style>
