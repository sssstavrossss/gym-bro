<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { keyboardEntry } from "../lib/viewport";
import {
  exerciseSummary,
  FIELD_LABELS,
  fieldText,
  formatSet,
  measureFields,
  parseField,
  secondsDigits,
  setHints,
  shortDay,
  type DraftExercise,
  type SetField,
} from "../lib/workout";
import { targetLine } from "../lib/plan";
import { FIRST_TIME_LINE, suggestionLine } from "../lib/progression";
import { maxText } from "../lib/records";
import { paceLine } from "../lib/cardio";
import { plateLine } from "../lib/plates";
import { addSet, addWarmups, exerciseItem, exerciseLoadTarget, exerciseNewBest, exerciseSuggestion, removeSet, setValue, toggleDone, workout } from "../state/workout";
import { openExercise, toast } from "../ui";

/** The cell being typed in. The workout sheet owns it, so its keypad can type into any card. */
export interface CellEdit {
  key: string | null;
  index: number;
  field: SetField;
  text: string;
  /** The first key replaces what was there. */
  fresh: boolean;
}

// One exercise in the workout: folded to a line, or open with its set table (docs/training.md, phase 2).
/** `past`: a workout logged or edited afterwards, so "last time" (the newest workout) doesn't apply. */
/** `prevName`: the exercise before this one, which the superset button joins it to; empty for the first. */
const props = defineProps<{ exercise: DraftExercise; open: boolean; edit: CellEdit; past?: boolean; prevName?: string }>();
const emit = defineEmits<{ expand: []; remove: []; swap: []; superset: [] }>();

const item = computed(() => exerciseItem(props.exercise.exerciseId));
const measure = computed(() => item.value?.measure ?? "weight_reps");
const fields = computed(() => measureFields(measure.value));
const last = computed(() => (props.past ? null : workout.previous[props.exercise.exerciseId] ?? null));
const lastSets = computed(() => last.value?.sets ?? []);
const lastWorking = computed(() => lastSets.value.filter((set) => set.type !== "warmup"));
const name = computed(() => item.value?.name ?? props.exercise.exerciseId);
const done = computed(() => props.exercise.sets.length > 0 && props.exercise.sets.every((set) => set.doneAt));
const summary = computed(() => exerciseSummary(props.exercise.sets, measure.value, props.exercise.exerciseId));
const ticked = computed(() => props.exercise.sets.filter((set) => set.doneAt).length);
const folded = computed(() => {
  if (summary.value) return done.value ? summary.value : `${ticked.value} of ${props.exercise.sets.length} · ${summary.value}`;
  const sets = props.exercise.sets.length;
  return `${sets} ${sets === 1 ? "set" : "sets"}`;
});
const subtitle = computed(() => {
  const target = props.exercise.target ? targetLine(props.exercise.target) : "";
  if (props.past) return target;
  const first = advice.value === FIRST_TIME_LINE ? "" : "First time";
  return [target, last.value ? `Last time ${shortDay(last.value.date)}` : first].filter(Boolean).join(" · ");
});
const loadTarget = computed(() => exerciseLoadTarget(props.exercise));

function warmUp() {
  const added = addWarmups(props.exercise.key);
  if (added) toast(`${added.count} warm-up ${added.count === 1 ? "set" : "sets"}, building to ${added.workKg} kg`);
}
const suggestion = computed(() => (props.past ? null : exerciseSuggestion(props.exercise)));
/** A best beaten in this workout: said once a ticked set does it. */
const newBest = computed(() => (props.past ? null : exerciseNewBest(props.exercise)));
/** What to lift: a suggestion from last time, or how to pick a weight the first time. */
const advice = computed(() => {
  if (props.past || !loadTarget.value || !item.value) return "";
  if (suggestion.value) return suggestionLine(suggestion.value, loadTarget.value);
  // Shown once the last workouts are known, so it doesn't flash before "Last time".
  const known = props.exercise.exerciseId in workout.previous;
  return known && !last.value && item.value.equipment !== "body only" ? FIRST_TIME_LINE : "";
});
const columns = computed(() => `var(--set-n) var(--set-lt) ${fields.value.map((field) => `var(--set-${field})`).join(" ")} var(--control-hit)`);

/** Warm-ups show W, drop sets D, working sets their number. */
const labels = computed(() => {
  let n = 0;
  return props.exercise.sets.map((set) => (set.type === "warmup" ? "W" : set.type === "drop" ? "D" : String(++n)));
});
const rows = computed(() => {
  let working = 0;
  return props.exercise.sets.map((set, index) => {
    const before = set.type === "warmup" ? null : lastWorking.value[working++] ?? null;
    return {
      set,
      index,
      label: labels.value[index],
      lastTime: set.type === "warmup" ? "" : before ? formatSet(before, measure.value) : "—",
      hints: setHints(props.exercise, index, lastSets.value, suggestion.value),
    };
  });
});
/** A barbell lift says what to load a side for the set being typed in, else the next to do, else the last. */
const barbell = computed(() => !props.past && item.value?.equipment === "barbell" && measure.value === "weight_reps");
const plates = computed(() => {
  if (!barbell.value) return "";
  const at = props.edit.key === props.exercise.key ? props.edit.index : rows.value.findIndex((row) => !row.set.doneAt);
  const row = rows.value[at >= 0 ? at : rows.value.length - 1];
  return plateLine(row ? row.set.kg ?? row.hints.kg : null);
});
/** A run, ride, row or swim says its pace for the set being typed in, else the last with a distance and a time. */
const pace = computed(() => (measure.value === "distance_time" ? paceLine(props.exercise, props.edit.key === props.exercise.key ? props.edit.index : null) : ""));
const canRemoveSet = computed(() => props.exercise.sets.length > 1 && !props.exercise.sets[props.exercise.sets.length - 1].doneAt);

const editing = (index: number, field: SetField) => props.edit.key === props.exercise.key && props.edit.index === index && props.edit.field === field;
const cellText = (index: number, field: SetField) => (editing(index, field) ? props.edit.text : fieldText(field, props.exercise.sets[index][field]));
/** "Set 2", "Drop set", and "Warm-up set", numbered when there is more than one. */
function setName(index: number) {
  const label = labels.value[index];
  if (label === "D") return "Drop set";
  if (label !== "W") return `Set ${label}`;
  const warmups = labels.value.filter((each) => each === "W").length;
  return warmups > 1 ? `Warm-up set ${labels.value.slice(0, index + 1).filter((each) => each === "W").length}` : "Warm-up set";
}

function onFocus(event: FocusEvent, index: number, field: SetField) {
  const value = props.exercise.sets[index][field];
  Object.assign(props.edit, { key: props.exercise.key, index, field, text: field === "seconds" ? secondsDigits(value) : fieldText(field, value), fresh: true });
  if (keyboardEntry.value) (event.target as HTMLInputElement).select();
}

function onBlur(index: number, field: SetField) {
  if (editing(index, field)) props.edit.key = null;
}

/** Typing with the phone's own keyboard or a computer's: keep only what the field takes. */
function onInput(event: Event, index: number, field: SetField) {
  const input = event.target as HTMLInputElement;
  const value = parseField(field, input.value);
  if (value === undefined) {
    input.value = props.edit.text;
    return;
  }
  props.edit.text = input.value;
  props.edit.fresh = false;
  setValue(props.exercise.key, index, field, value);
}
</script>

<template>
  <section v-if="!open" class="card inset fold" :data-workout-exercise="exercise.exerciseId">
    <button type="button" class="row frow" :aria-label="`${name}, ${folded}. Open`" @click="emit('expand')">
      <span class="t-body grow fname">{{ name }}</span>
      <span class="t-capn c2 fsum">{{ folded }}</span>
      <span v-if="done" class="okdot" aria-hidden="true"><Icon name="check" :size="12" :sw="3" /></span>
    </button>
  </section>

  <section v-else class="card inset col exc" :aria-label="name" :data-workout-exercise="exercise.exerciseId" data-open>
    <div class="chead">
      <span class="col grow g2">
        <h3 class="t-bodys m0">{{ name }}</h3>
        <span v-if="subtitle" class="t-capn c2">{{ subtitle }}</span>
        <span v-if="advice" class="t-capn c2" :data-load-suggestion="suggestion?.kind ?? 'first'">{{ advice }}</span>
        <span v-if="newBest" class="t-capn best" data-new-best><Icon name="check" :size="12" :sw="3" /><span>New best: est. max {{ maxText(newBest.estimatedMax) }}</span></span>
      </span>
      <button
        v-if="prevName" type="button" class="cbtn" :class="{ filled: exercise.superset }" :aria-pressed="!!exercise.superset"
        :aria-label="`Superset with ${prevName}`" data-superset-prev @click="emit('superset')"
      ><Icon name="link" :size="18" /></button>
      <button type="button" class="cbtn" :aria-label="`How to do ${name}`" @click="openExercise(exercise.exerciseId)"><Icon name="info" :size="18" /></button>
    </div>

    <div class="sets" :class="{ nolast: past }" :style="{ gridTemplateColumns: columns }" role="table" :aria-label="`${name} sets`">
      <div class="srow" role="row">
        <span class="t-capn c3" role="columnheader">Set</span>
        <span class="t-capn c3 lt" role="columnheader">Last time</span>
        <span v-for="field in fields" :key="field" class="t-capn c3 mid" role="columnheader">{{ FIELD_LABELS[field] }}</span>
        <span role="columnheader"><span class="sr-only">Done</span></span>
      </div>
      <div v-for="row in rows" :key="row.index" class="srow" role="row" :data-set="row.index" :data-done="row.set.doneAt ? '' : undefined">
        <span class="t-label c2 mid" role="cell">{{ row.label }}</span>
        <span class="t-label c2 lt" role="cell">{{ row.lastTime }}</span>
        <span v-for="field in fields" :key="field" role="cell" class="cellwrap">
          <input
            class="cell t-bodys" :class="{ typed: row.set[field] != null || editing(row.index, field) }"
            :value="cellText(row.index, field)" :placeholder="fieldText(field, row.hints[field])"
            :inputmode="keyboardEntry ? (field === 'kg' || field === 'metres' ? 'decimal' : 'numeric') : 'none'"
            enterkeyhint="next" autocomplete="off" data-no-autofocus :data-cell="`${exercise.key}-${row.index}-${field}`"
            :aria-label="`${setName(row.index)}, ${FIELD_LABELS[field]}`"
            @focus="onFocus($event, row.index, field)" @blur="onBlur(row.index, field)" @input="onInput($event, row.index, field)"
          />
        </span>
        <span role="cell">
          <button
            type="button" class="tick" :class="{ on: row.set.doneAt }" :aria-pressed="row.set.doneAt != null"
            :aria-label="`${setName(row.index)} done`" @mousedown.prevent @click="toggleDone(exercise.key, row.index)"
          ><Icon name="check" :size="14" :sw="3" /></button>
        </span>
      </div>
    </div>

    <p v-if="plates" class="t-capn c2 m0" data-plates>{{ plates }}</p>
    <p v-if="pace" class="t-capn c2 m0" data-pace>{{ pace }}</p>

    <div class="row acts">
      <button type="button" class="btn sm secondary t-label" @click="addSet(exercise.key)"><Icon name="plus" :size="14" /> Set</button>
      <button type="button" class="btn sm secondary t-label" data-add-warmup @click="warmUp"><Icon name="plus" :size="14" /> Warm-up</button>
      <span class="row ends">
      <button type="button" class="cbtn" aria-label="Remove the last set" :disabled="!canRemoveSet" @click="removeSet(exercise.key, exercise.sets.length - 1)"><Icon name="minus" :size="18" /></button>
      <button type="button" class="cbtn" :aria-label="`Swap ${name}`" data-swap @click="emit('swap')"><Icon name="swap" :size="18" /></button>
      <button type="button" class="cbtn" :aria-label="`Remove ${name}`" @click="emit('remove')"><Icon name="trash" :size="18" /></button>
      </span>
    </div>
  </section>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.fold { padding: 0 var(--space-m); }
.frow { width: 100%; min-height: var(--control-hit); padding-block: var(--space-s); gap: var(--space-s); background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.fname { min-width: 0; overflow-wrap: anywhere; }
.fsum { flex: 0 1 auto; min-width: 0; text-align: right; overflow-wrap: anywhere; }
.okdot { width: 18px; height: 18px; border-radius: var(--radius-pill); flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--color-action); color: var(--color-on-action); }
.exc { padding: var(--space-m); gap: var(--space-s); }
.exc .chead { flex-wrap: nowrap; }
.best { color: var(--color-action); display: inline-flex; align-items: baseline; gap: var(--space-2xs); }
.best :deep(svg) { flex: none; align-self: center; }
/* Column widths per field. The tick is a full hit target; its circle is drawn smaller inside. */
.sets {
  --set-n: 24px; --set-lt: minmax(0, 1fr); --set-kg: 60px; --set-reps: 48px; --set-rir: 40px; --set-seconds: 64px; --set-metres: 64px;
  display: grid; column-gap: var(--space-xs); row-gap: var(--space-xs); align-items: center;
}
.srow { display: contents; }
.mid { text-align: center; }
.lt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cellwrap { display: block; min-width: 0; }
.cell {
  width: 100%; height: var(--control-chip); padding: 0 var(--space-2xs); border: 0; border-radius: var(--radius-s);
  background: var(--color-surface); color: var(--text-primary); text-align: center; font-variant-numeric: tabular-nums;
  caret-color: var(--text-primary);
}
.cell::placeholder { color: var(--text-tertiary); opacity: 1; }
.cell:focus, .cell:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
.tick { width: var(--control-hit); height: var(--control-hit); display: flex; align-items: center; justify-content: center; background: none; border: 0; color: var(--text-tertiary); padding: 0; }
.tick :deep(svg) { width: 26px; height: 26px; padding: 6px; border-radius: var(--radius-pill); box-shadow: inset 0 0 0 1.5px var(--color-border-strong); box-sizing: border-box; }
.tick.on { color: var(--color-on-action); }
.tick.on :deep(svg) { background: var(--color-action); box-shadow: none; }
.acts { gap: var(--space-s); flex-wrap: nowrap; }
/* − and the bin stay together at the right end, also when the row wraps. */
.acts .ends { gap: var(--space-s); margin-left: auto; flex-wrap: nowrap; }
/* The largest text sizes drop "last time": the grey hints in each cell already show it. */
.dt-xl .sets .lt, .sets.nolast .lt { visibility: hidden; }
.dt-xl .sets, .sets.nolast { --set-lt: 0px; --set-kg: minmax(0, 1fr); --set-reps: minmax(0, 1fr); --set-rir: minmax(0, 1fr); --set-seconds: minmax(0, 1fr); --set-metres: minmax(0, 1fr); }
.dt-xl .acts { flex-wrap: wrap; }
</style>
