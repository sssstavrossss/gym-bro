<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { clockTime, FIELD_LABELS, measureFields, setHints, type DraftExercise, type SetField } from "../lib/workout";
import { setName } from "../lib/setEntry";
import { dialSpec, fieldDial } from "../lib/dial";
import { FIELD_CAPTIONS, fieldParts, type RowState } from "../lib/timeline";
import { plateLine } from "../lib/plates";
import { paceLine } from "../lib/cardio";
import { exerciseItem, exerciseSuggestion, pickValue, toggleDone, workout } from "../state/workout";
import { openDial } from "../ui";

// One set on the workout's timeline (README, *Logging a workout*). The set to do is a small scoreboard: its numbers
// big, each one a button that opens the number wheel, and its ✓ to log it. Done and planned sets are one quiet line,
// their numbers buttons too. A number not picked yet shows the hint (the set before, last time, or the suggestion)
// in grey, and a log takes it.
/** `title`: in a superset or circuit, which exercise the set to do is ("B · Triceps Pushdown"). */
const props = defineProps<{ exercise: DraftExercise; index: number; state: RowState; past?: boolean; title?: string }>();

const item = computed(() => exerciseItem(props.exercise.exerciseId));
const measure = computed(() => item.value?.measure ?? "weight_reps");
const fields = computed(() => measureFields(measure.value));
const set = computed(() => props.exercise.sets[props.index]);
const hints = computed(() => setHints(
  props.exercise, props.index,
  props.past ? [] : workout.previous[props.exercise.exerciseId]?.sets ?? [],
  props.past ? null : exerciseSuggestion(props.exercise),
));
const name = computed(() => setName(props.exercise.sets, props.index));
const exName = computed(() => item.value?.name ?? props.exercise.exerciseId);
const shown = (field: SetField) => set.value[field] ?? hints.value[field];
const typed = (field: SetField) => set.value[field] != null;
const parts = (field: SetField) => fieldParts(field, shown(field));
const isNow = computed(() => props.state === "now");

/** A barbell lift says what to load a side; a run, ride or row its pace. */
const plates = computed(() => (!props.past && item.value?.equipment === "barbell" && measure.value === "weight_reps" ? plateLine(shown("kg")) : ""));
const pace = computed(() => (measure.value === "distance_time" ? paceLine(props.exercise, props.index) : ""));

function hintFor(field: SetField, value: number | null): string | undefined {
  if (field === "kg" && item.value?.equipment === "barbell") return plateLine(value);
  const target = props.exercise.target;
  if (field === "reps" && target?.repMin != null && target.repMax != null) return target.repMin === target.repMax ? `Aim: ${target.repMin}` : `Aim: ${target.repMin}–${target.repMax}`;
  if (field === "rir") return "Reps in reserve: 0 is all-out";
  return undefined;
}

function edit(field: SetField, event: MouseEvent) {
  const before = shown(field);
  const id = fieldDial(field, item.value?.equipment);
  const spec = dialSpec(id, { label: `${exName.value} · ${name.value} · ${FIELD_CAPTIONS[field]}`, hint: hintFor(field, before), value: before });
  openDial(spec, event.currentTarget as Element, (value) => pickValue(props.exercise.key, props.index, field, value, before));
}
const valueLabel = (field: SetField) => `${name.value}, ${FIELD_LABELS[field]}`;
/** Between kg and reps a ×, as a set is said: 60 × 10. */
const times = (field: SetField) => measure.value === "weight_reps" && field === "reps" && fields.value.includes("kg");
</script>

<template>
  <!-- The set to do: a scoreboard -->
  <div
    v-if="isNow" class="col board" data-set-state="now" :data-set="index" :data-exercise="exercise.exerciseId"
  >
    <span v-if="title" class="t-capn c2 btitle">{{ title }}</span>
    <div class="row cells">
      <button
        v-for="field in fields" :key="field" type="button" class="cell" :class="{ hinted: !typed(field) }" :aria-label="valueLabel(field)"
        :data-cell="`${exercise.key}-${index}-${field}`" @click="edit(field, $event)"
      >
        <span class="t-capn c2 cap">{{ FIELD_CAPTIONS[field] }}</span>
        <span class="big tnum">{{ parts(field).n }}<span v-if="field === 'metres' && shown(field) != null" class="bu">{{ parts(field).unit }}</span></span>
      </button>
      <button
        type="button" class="cbtn filled logbig" :aria-label="`${name} done`" aria-pressed="false" :disabled="workout.saving" data-log-set
        @click="toggleDone(exercise.key, index)"
      ><Icon name="check" :size="22" :sw="2.8" /></button>
    </div>
    <span v-if="plates" class="t-capn c2 bsub" data-plates>{{ plates }}</span>
    <span v-if="pace" class="t-capn c2 bsub" data-pace>{{ pace }}</span>
  </div>

  <!-- Done and planned: one line -->
  <div
    v-else class="row oneline" :class="state" :data-set-state="state" :data-set="index" :data-exercise="exercise.exerciseId"
    :data-done="set.doneAt ? '' : undefined"
  >
    <span class="row nums">
      <template v-for="field in fields" :key="field">
        <span v-if="times(field)" class="x" aria-hidden="true">×</span>
        <button
          type="button" class="nv" :class="{ hinted: !typed(field) && !set.doneAt, rir: field === 'rir' }" :aria-label="valueLabel(field)"
          :data-cell="`${exercise.key}-${index}-${field}`" @click="edit(field, $event)"
        >
          <span class="in">
            <span v-if="field === 'rir'" class="u">RIR</span>
            <span class="n tnum">{{ parts(field).n }}</span>
            <span v-if="field !== 'rir' && !times(field) && parts(field).unit" class="u">{{ parts(field).unit }}</span>
          </span>
        </button>
      </template>
    </span>
    <span v-if="set.doneAt && !past" class="t-capn c3 tnum at">{{ clockTime(set.doneAt) }}</span>
    <button
      type="button" class="cbtn tick" :class="{ on: !!set.doneAt }" :aria-label="`${name} done`" :aria-pressed="!!set.doneAt"
      :disabled="workout.saving" @click="toggleDone(exercise.key, index)"
    ><Icon name="check" :size="set.doneAt ? 14 : 16" :sw="set.doneAt ? 3 : 2.4" /></button>
  </div>
</template>

<style scoped>
.tnum { font-variant-numeric: tabular-nums; }

/* The set to do: a scoreboard */
.board { flex: 1 1 auto; min-width: 0; gap: var(--space-2xs); padding: var(--space-xs); border-radius: var(--radius-l); background: var(--color-surface-2); }
.row.cells { flex-wrap: nowrap; gap: var(--space-2xs); align-items: stretch; }
.cell {
  flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
  min-height: 60px; padding: var(--space-xs) 0; border: 0; border-radius: var(--radius-m); background: none; color: var(--text-primary);
}
.cell:active { background: var(--color-hover); }
.cell + .cell { box-shadow: -1px 0 0 var(--color-border); border-radius: 0; }
.cap { line-height: 1; }
.btitle { padding: 0 var(--space-xs); overflow-wrap: anywhere; }
/* Capped in px: a cell is a third of the row, and 102.5 must still fit at the largest text size. */
.big { font-size: min(1.45rem, 26px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; }
.bu { font-size: 0.6em; font-weight: 600; margin-left: 2px; }
.cell.hinted .big { color: var(--text-secondary); }
.logbig { --s: 48px; width: 56px; height: auto; min-height: 56px; align-self: center; margin-left: var(--space-xs); flex: none; }
.bsub { text-align: center; padding-right: 60px; }

/* One line: done and planned */
.row.oneline { flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; gap: var(--space-xs); min-height: var(--control-hit); }
.row.nums { flex: 1 1 auto; min-width: 0; gap: 2px; flex-wrap: wrap; align-items: center; }
.in { display: inline-flex; align-items: baseline; gap: 3px; }
.nv {
  display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-hit); min-width: 32px;
  padding: 0 var(--space-xs); border: 0; background: none; color: inherit;
}
.n { font-weight: 500; font-size: 1rem; }
.u { color: var(--text-tertiary); font-size: 0.7059rem; }
.x { color: var(--text-tertiary); line-height: 1; }
.rir { margin-left: var(--space-xs); }
.oneline.done { color: var(--text-primary); }
.oneline.next { color: var(--text-secondary); }
.nv.hinted .n { color: var(--text-tertiary); }
.at { flex: none; }
.tick { flex: none; color: var(--text-tertiary); }
.tick::before { --s: 28px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-border-strong); }
.tick.on { color: var(--color-on-action); }
.tick.on::before { --s: 24px; background: var(--color-action); box-shadow: none; }
</style>
