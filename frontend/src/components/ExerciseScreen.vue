<script setup lang="ts">
import { computed, reactive } from "vue";
import Icon from "./Icon.vue";
import { photoUrl, typeLabel } from "../lib/exercises";
import { clock, clockTime, exerciseSummary, formatSet, setHints, shortDay, type DraftExercise } from "../lib/workout";
import { setLabels } from "../lib/setEntry";
import { FIRST_TIME_LINE, suggestionLine } from "../lib/progression";
import { maxText } from "../lib/records";
import { paceLine } from "../lib/cardio";
import { plateLine } from "../lib/plates";
import { exercises } from "../state/exercises";
import { dialSpec, REST_HINTS, restDial } from "../lib/dial";
import { addWarmups, exerciseItem, exerciseLoadTarget, exerciseNewBest, exerciseRest, exerciseSuggestion, removeSet, setExerciseRest, workout } from "../state/workout";
import { openDial, toast } from "../ui";

// One exercise of a quick workout on a screen of its own, like a food's amount screen (README, *Logging a workout*):
// its photos and kind, what to lift, and the sets so far. The workout sheet's footer types and logs the next set.
const props = defineProps<{ exercise: DraftExercise; target: number; prevName?: string }>();
const emit = defineEmits<{ select: [number]; swap: []; remove: []; superset: [] }>();

const item = computed(() => exerciseItem(props.exercise.exerciseId));
const measure = computed(() => item.value?.measure ?? "weight_reps");
const name = computed(() => item.value?.name ?? props.exercise.exerciseId);
const last = computed(() => workout.previous[props.exercise.exerciseId] ?? null);
const lastSets = computed(() => last.value?.sets ?? []);

const broken = reactive(new Set<number>());
const photos = computed(() => (item.value && exercises.photos ? [0, 1].filter((at) => at < item.value!.images && !broken.has(at)) : []));
const muscles = computed(() => (item.value?.primaryMuscles ?? []).slice(0, 2).map((muscle) => muscle[0].toUpperCase() + muscle.slice(1)).join(", "));
const meta = computed(() => [item.value?.equipment && item.value.equipment !== "other" ? cap(item.value.equipment) : "", muscles.value].filter(Boolean).join(" · "));
const cap = (text: string) => text[0].toUpperCase() + text.slice(1);

const suggestion = computed(() => exerciseSuggestion(props.exercise));
const loadTarget = computed(() => exerciseLoadTarget(props.exercise));
const newBest = computed(() => exerciseNewBest(props.exercise));
/** What to lift: a suggestion from last time, or how to pick a weight the first time. */
const advice = computed(() => {
  if (!loadTarget.value || !item.value) return "";
  if (suggestion.value) return suggestionLine(suggestion.value, loadTarget.value);
  const known = props.exercise.exerciseId in workout.previous;
  return known && !last.value && item.value.equipment !== "body only" ? FIRST_TIME_LINE : "";
});
const lastLine = computed(() => {
  if (!last.value) return props.exercise.exerciseId in workout.previous && advice.value !== FIRST_TIME_LINE ? "First time" : "";
  const line = exerciseSummary(lastSets.value.map((set) => ({ ...set, doneAt: last.value!.date })), measure.value, props.exercise.exerciseId);
  return `Last time, ${shortDay(last.value.date)}${line ? `: ${line}` : ""}`;
});

const labels = computed(() => setLabels(props.exercise.sets));
/** Each set: done ones with their time, the rest with what they'd take (typed, else the hints). */
const rows = computed(() => props.exercise.sets.map((set, index) => {
  const hints = setHints(props.exercise, index, lastSets.value, suggestion.value);
  const shown = { kg: set.kg ?? hints.kg, reps: set.reps ?? hints.reps, rir: set.rir ?? hints.rir, seconds: set.seconds ?? hints.seconds, metres: set.metres ?? hints.metres };
  const text = formatSet(set.doneAt ? set : shown, measure.value, props.exercise.exerciseId);
  return { index, label: labels.value[index], text: text || "—", at: set.doneAt ? clockTime(set.doneAt) : "", done: !!set.doneAt };
}));
/** One more after the last, while every set is done: what the next log adds. */
const extra = computed(() => props.target >= props.exercise.sets.length);

const barbell = computed(() => item.value?.equipment === "barbell" && measure.value === "weight_reps");
const plates = computed(() => {
  if (!barbell.value) return "";
  const sets = props.exercise.sets;
  const set = sets[Math.min(props.target, sets.length - 1)];
  if (!set) return plateLine(null);
  const hints = setHints(props.exercise, props.target, lastSets.value, suggestion.value);
  return plateLine(set.kg ?? hints.kg);
});
const pace = computed(() => (measure.value === "distance_time" ? paceLine(props.exercise, props.target < props.exercise.sets.length ? props.target : null) : ""));
const canRemoveSet = computed(() => props.exercise.sets.length > 1 && !props.exercise.sets[props.exercise.sets.length - 1].doneAt);

/** The rest after its sets, set on the number wheel; an exercise with no rest (cardio, a stretch) has no button. */
const rest = computed(() => exerciseRest(props.exercise));
function setRest(event: MouseEvent) {
  const id = restDial(item.value);
  openDial(dialSpec(id, { label: `Rest · ${name.value}`, hint: REST_HINTS[id], value: rest.value }), event.currentTarget as Element, (seconds) => setExerciseRest(props.exercise.key, seconds));
}

function warmUp() {
  const added = addWarmups(props.exercise.key);
  if (added) toast(`${added.count} warm-up ${added.count === 1 ? "set" : "sets"}, building to ${added.workKg} kg`);
  emit("select", 0);
}
</script>

<template>
  <div class="col body" :data-workout-exercise="exercise.exerciseId" data-exercise-screen>
    <div v-if="photos.length" class="row photos">
      <img v-for="at in photos" :key="at" :src="photoUrl(exercises.photos, exercise.exerciseId, at)" alt="" @error="broken.add(at)" />
    </div>
    <div v-if="item" class="row meta">
      <span class="tag t-capn">{{ typeLabel(item) }}</span>
      <span class="t-capn c2 grow">{{ meta }}</span>
      <button
        v-if="rest || exercise.rest != null" type="button" class="btn sm secondary t-label tnum restset" :aria-label="`Rest ${clock(rest)}, change`"
        data-rest-setting @click="setRest"
      ><Icon name="clock" :size="14" /> {{ clock(rest) }}</button>
    </div>
    <div v-if="advice || lastLine || newBest" class="well col g2">
      <span v-if="advice" class="t-label" :data-load-suggestion="suggestion?.kind ?? 'first'">{{ advice }}</span>
      <span v-if="lastLine" class="t-capn c2" data-last-time>{{ lastLine }}</span>
      <span v-if="newBest" class="t-capn best" data-new-best><Icon name="check" :size="12" :sw="3" /><span>New best: est. max {{ maxText(newBest.estimatedMax) }}</span></span>
    </div>

    <ol class="list" :aria-label="`${name} sets`">
      <li v-for="row in rows" :key="row.index">
        <button
          type="button" class="row srow" :class="{ on: row.index === target, done: row.done }" :aria-current="row.index === target ? 'true' : undefined"
          :data-set="row.index" :data-done="row.done ? '' : undefined" @click="emit('select', row.index)"
        >
          <span class="t-label c3 sn">{{ row.label }}</span>
          <span class="t-body grow tnum" :class="{ c2: !row.done }">{{ row.text }}</span>
          <span v-if="row.done" class="t-capn c3 tnum">{{ row.at }}</span>
          <span v-else-if="row.index === target" class="t-capn c2">next</span>
          <span v-if="row.done" class="okdot" aria-hidden="true"><Icon name="check" :size="12" :sw="3" /></span>
        </button>
      </li>
      <li v-if="extra">
        <div class="row srow on" aria-current="true" data-set-extra>
          <span class="t-label c3 sn">{{ labels.filter((label) => label !== "W" && label !== "D").length + 1 }}</span>
          <span class="t-body c2 grow">One more set</span>
          <span class="t-capn c2">next</span>
        </div>
      </li>
    </ol>

    <p v-if="plates" class="t-capn c2 m0" data-plates>{{ plates }}</p>
    <p v-if="pace" class="t-capn c2 m0" data-pace>{{ pace }}</p>

    <div class="row acts">
      <button v-if="!exercise.part" type="button" class="btn sm secondary t-label" data-add-warmup @click="warmUp"><Icon name="plus" :size="14" /> Warm-up</button>
      <button
        v-if="prevName" type="button" class="btn sm secondary t-label" :aria-label="`Superset with ${prevName}`" data-superset-prev @click="emit('superset')"
      ><Icon name="link" :size="14" /> Superset</button>
      <span class="row ends">
        <button type="button" class="cbtn" aria-label="Remove the last set" :disabled="!canRemoveSet" @click="removeSet(exercise.key, exercise.sets.length - 1)"><Icon name="minus" :size="18" /></button>
        <button type="button" class="cbtn" :aria-label="`Swap ${name}`" data-swap @click="emit('swap')"><Icon name="swap" :size="18" /></button>
        <button type="button" class="cbtn" :aria-label="`Remove ${name}`" @click="emit('remove')"><Icon name="trash" :size="18" /></button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.body { gap: var(--space-m); padding-bottom: var(--space-l); }
.photos { gap: var(--space-s); flex-wrap: nowrap; }
.photos img { flex: 1 1 0; min-width: 0; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-m); background: var(--color-surface-2); }
.row.meta { gap: var(--space-s); flex-wrap: nowrap; align-items: center; }
.restset { flex: none; margin-block: calc((var(--control-chip) - var(--control-hit)) / 2); }
.best { color: var(--color-action); display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.best :deep(svg) { flex: none; align-self: center; }
.list { list-style: none; margin: 0; padding: 0; }
.row.srow {
  width: 100%; min-height: var(--control-hit); gap: var(--space-m); flex-wrap: nowrap; padding: var(--space-xs) var(--space-s);
  background: none; border: 0; border-bottom: 1px solid var(--color-border); color: inherit; text-align: left; border-radius: 0;
}
.row.srow.on { background: var(--color-surface-2); border-radius: var(--radius-m); border-bottom-color: transparent; }
.sn { width: 16px; flex: none; text-align: center; }
.tnum { font-variant-numeric: tabular-nums; }
.okdot { width: 18px; height: 18px; border-radius: var(--radius-pill); flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--color-action); color: var(--color-on-action); }
.acts { gap: var(--space-s); flex-wrap: nowrap; }
.acts .ends { gap: var(--space-s); margin-left: auto; flex-wrap: nowrap; }
html.dt-xl .acts { flex-wrap: wrap; }
</style>
