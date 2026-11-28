<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Icon from "./Icon.vue";
import { clockTime, FIELD_LABELS, measureFields, setHints, type DraftExercise, type SetField } from "../lib/workout";
import { setName } from "../lib/setEntry";
import { dialSpec, fieldDial } from "../lib/dial";
import { FIELD_CAPTIONS, fieldParts, type RowState } from "../lib/timeline";
import { plateLine } from "../lib/plates";
import { paceLine } from "../lib/cardio";
import { exerciseItem, exerciseSuggestion, pickValue, toggleDone, workout } from "../state/workout";
import { openDial } from "../ui";

// One set on the workout's timeline (README, *Logging a workout*): its numbers on one line, each a button that opens
// the number wheel. The set to do is the same line a touch bigger, with its ✓ to log it; any other set is ticked or
// unticked by its node on the rail. A number not picked yet shows the hint (the set before, last time, or the
// suggestion) in grey, and a log takes it. A long press (or a right click) asks the timeline for the set's menu.
/** `title`: in a superset or circuit, which exercise the set to do is ("B · Triceps Pushdown"). */
const props = defineProps<{ exercise: DraftExercise; index: number; state: RowState; past?: boolean; title?: string }>();
const emit = defineEmits<{ menu: [Element] }>();

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
/** A done set shows only what was logged: no "RIR —" after it. */
const showing = computed(() => fields.value.filter((field) => !set.value.doneAt || set.value[field] != null || field !== "rir"));

/** A barbell lift says what to load a side; a run, ride or row its pace. */
const plates = computed(() => (isNow.value && !props.past && item.value?.equipment === "barbell" && measure.value === "weight_reps" ? plateLine(shown("kg")) : ""));
const pace = computed(() => (isNow.value && measure.value === "distance_time" ? paceLine(props.exercise, props.index) : ""));

function hintFor(field: SetField, value: number | null): string | undefined {
  if (field === "kg" && item.value?.equipment === "barbell") return plateLine(value);
  const target = props.exercise.target;
  if (field === "reps" && target?.repMin != null && target.repMax != null) return target.repMin === target.repMax ? `Aim: ${target.repMin}` : `Aim: ${target.repMin}–${target.repMax}`;
  if (field === "rir") return "Reps in reserve: 0 is all-out";
  return undefined;
}

function edit(field: SetField, event: MouseEvent) {
  if (held) return;
  const before = shown(field);
  const id = fieldDial(field, item.value?.equipment);
  const spec = dialSpec(id, { label: `${exName.value} · ${name.value} · ${FIELD_CAPTIONS[field]}`, hint: hintFor(field, before), value: before });
  openDial(spec, event.currentTarget as Element, (value) => pickValue(props.exercise.key, props.index, field, value, before));
}
const valueLabel = (field: SetField) => `${name.value}, ${FIELD_LABELS[field]}`;
/** Between kg and reps a ×, as a set is said: 60 × 10; before reps in reserve a dot. */
/** "60 kg × 10": reps after a weight need no word; reps on their own do ("12 reps"). */
const unitOf = (field: SetField) => (field === "rir" || (field === "reps" && showing.value.includes("kg")) ? "" : parts(field).unit);
const between = (field: SetField, at: number) => (at === 0 ? "" : measure.value === "weight_reps" && field === "reps" && showing.value.includes("kg") ? "×" : "·");

// ---- A long press: the set's menu ----
const root = ref<HTMLElement | null>(null);
let timer: number | undefined;
let start: { x: number; y: number } | null = null;
/** The press that opened the menu doesn't also open a number. */
let held = false;
function press(event: PointerEvent) {
  if (event.button !== 0) return;
  held = false;
  start = { x: event.clientX, y: event.clientY };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    held = true;
    navigator.vibrate?.(10);
    if (root.value) emit("menu", root.value);
  }, 450);
}
function move(event: PointerEvent) {
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel();
}
function cancel() {
  window.clearTimeout(timer);
  start = null;
  window.setTimeout(() => { held = false; }, 0);
}
function context(event: MouseEvent) {
  event.preventDefault();
  window.clearTimeout(timer);
  if (root.value) emit("menu", root.value);
}
onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <div
    ref="root" class="col setr" :class="state" :data-set-state="state" :data-set="index" :data-exercise="exercise.exerciseId"
    :data-done="set.doneAt ? '' : undefined"
    @pointerdown="press" @pointermove="move" @pointerup="cancel" @pointerleave="cancel" @pointercancel="cancel" @contextmenu="context"
  >
    <span v-if="isNow && title" class="t-capn c2 btitle">{{ title }}</span>
    <div class="row line">
      <span class="row nums" :class="isNow ? 't-head' : 't-body'">
        <template v-for="(field, at) in showing" :key="field">
          <span v-if="between(field, at)" class="x t-capn" aria-hidden="true">{{ between(field, at) }}</span>
          <button
            type="button" class="nv" :class="{ hinted: !typed(field) && !set.doneAt }" :aria-label="valueLabel(field)"
            :data-cell="`${exercise.key}-${index}-${field}`" @click="edit(field, $event)"
          >
            <span class="in">
              <span v-if="field === 'rir'" class="u t-capn rir">RIR</span>
              <span class="n tnum">{{ parts(field).n }}</span>
              <span v-if="unitOf(field)" class="u t-capn">{{ unitOf(field) }}</span>
            </span>
          </button>
        </template>
      </span>
      <button
        v-if="isNow" type="button" class="cbtn filled tick" :aria-label="`${name} done`" aria-pressed="false" :disabled="workout.saving" data-log-set
        @click="toggleDone(exercise.key, index)"
      ><Icon name="check" :size="14" :sw="3" /></button>
      <span v-else-if="set.doneAt && !past" class="t-capn c3 tnum at">{{ clockTime(set.doneAt) }}</span>
    </div>
    <span v-if="plates" class="t-capn c2 bsub" data-plates>{{ plates }}</span>
    <span v-if="pace" class="t-capn c2 bsub" data-pace>{{ pace }}</span>
  </div>
</template>

<style scoped>
.tnum { font-variant-numeric: tabular-nums; }

/* No text selection or iOS callout: a long press opens the set's menu. */
.setr { flex: 1 1 auto; min-width: 0; gap: 0; touch-action: pan-y; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.setr.now { padding-block: var(--space-2xs); }
.btitle { overflow-wrap: anywhere; }
.row.line { flex-wrap: nowrap; gap: var(--space-xs); min-height: var(--control-hit); }
.row.nums { flex: 1 1 auto; min-width: 0; gap: var(--space-2xs); flex-wrap: wrap; align-items: center; }
.in { display: inline-flex; align-items: baseline; gap: 2px; }
.nv {
  display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-hit); min-width: 28px;
  padding: 0 var(--space-2xs); border: 0; background: none; color: inherit; font: inherit;
}
.u { color: var(--text-secondary); }
.u.rir { margin-right: var(--space-2xs); }
.x { color: var(--text-tertiary); line-height: 1; }
.setr.done { color: var(--text-primary); }
.setr.next { color: var(--text-secondary); }
.nv.hinted .n { color: var(--text-tertiary); }
.setr.now .nv.hinted .n { color: var(--text-secondary); }
.at { flex: none; }
/* The ✓: a small face in its 44px hit, its right edge where the times end on the rows above */
.tick { --s: var(--control-s-sm); justify-content: flex-end; }
.tick::before { right: 0; }
.tick > :deep(svg) { margin-right: 5px; }
.bsub { padding-bottom: var(--space-2xs); }
</style>
