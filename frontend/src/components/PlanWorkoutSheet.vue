<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import ExerciseBrowser from "./ExerciseBrowser.vue";
import Icon from "./Icon.vue";
import SwapList from "./SwapList.vue";
import type { PlanExercise } from "../lib/plan";
import { prescription } from "../lib/plan";
import {
  defaultPrescription,
  estimateMinutes,
  MAX_EXERCISES,
  MAX_NAME,
  MAX_REPS,
  MAX_REST,
  MAX_SECONDS,
  MAX_SETS,
  MIN_SECONDS,
  movedExercise,
  removed,
  prescribedBy,
  restLine,
  sameExercises,
  stepReps,
  stepRest,
  stepSeconds,
  stepSets,
} from "../lib/planEdit";
import { clock } from "../lib/workout";
import { exercises as library, loadExercises } from "../state/exercises";
import { plan, savePlanWorkout } from "../state/plan";
import { closeSheet, toast, toastError, ui } from "../ui";

// Edit a plan workout by hand (docs/training.md, phase 5; README → Edit a plan workout): its exercises in order,
// each one's sets, reps or hold, and rest. Nothing is saved until Save.
const open = computed(() => ui.sheet === "plan-workout");
const source = computed(() => plan.current?.workouts.find((item) => item.id === ui.planWorkoutId) ?? null);
const list = ref<PlanExercise[]>([]);
/** The exercise showing its steppers and actions; one at a time. */
const openIndex = ref<number | null>(null);
const view = ref<"edit" | "add" | "swap">("edit");
const swapIndex = ref<number | null>(null);
const name = ref("");

watch(open, (shown) => {
  if (!shown) return;
  void loadExercises();
  list.value = (source.value?.exercises ?? []).map((item) => ({ ...item }));
  name.value = source.value?.name ?? "";
  openIndex.value = null;
  view.value = "edit";
  swapIndex.value = null;
});

const byId = computed(() => new Map(library.items.map((item) => [item.id, item])));
const nameOf = (id: string) => byId.value.get(id)?.name ?? id;
const measureOf = (id: string) => prescribedBy(byId.value.get(id)?.measure ?? "weight_reps");
const sets = computed(() => list.value.reduce((sum, item) => sum + item.sets, 0));
const minutes = computed(() => estimateMinutes(list.value, plan.current?.minutes ?? 60));
const summary = computed(() => {
  const count = list.value.length;
  return `${count} ${count === 1 ? "exercise" : "exercises"} · ${sets.value} ${sets.value === 1 ? "set" : "sets"} · ~${minutes.value} min`;
});
/** The name as it will be saved: spaces tidied, empty not allowed. */
const cleanName = computed(() => name.value.trim().replace(/\s+/g, " "));
const renamed = computed(() => !!source.value && cleanName.value !== source.value.name);
const changed = computed(() => !!source.value && (renamed.value || !sameExercises(list.value, source.value.exercises)));
const canSave = computed(() => changed.value && list.value.length > 0 && cleanName.value.length > 0 && !plan.saving);
const title = computed(() => {
  if (view.value === "add") return "Add exercise";
  if (view.value === "swap" && swapIndex.value != null) return `Swap ${nameOf(list.value[swapIndex.value]?.exerciseId ?? "")}`;
  return source.value ? `Edit ${source.value.name}` : "Edit workout";
});
/** In a circuit (a Hyrox station round) there's no rest between exercises: the line says it's a circuit instead. */
const inCircuit = (index: number) => !!list.value[index]?.superset || !!list.value[index + 1]?.superset;
const line = (item: PlanExercise, index: number) =>
  [prescription(item), item.format ? "Circuit, for time" : inCircuit(index) ? "Circuit" : restLine(item.restSeconds)].join(" · ");

function update(index: number, next: PlanExercise) {
  list.value = list.value.map((item, at) => (at === index ? next : item));
}

function move(index: number, by: -1 | 1) {
  list.value = movedExercise(list.value, index, by);
  openIndex.value = index + by;
}

function remove(index: number) {
  const name = nameOf(list.value[index].exerciseId);
  list.value = removed(list.value, index);
  openIndex.value = null;
  toast(`Removed ${name}`);
}

function add(id: string) {
  const item = byId.value.get(id);
  if (!item || !plan.current) return;
  if (list.value.some((each) => each.exerciseId === id)) {
    toastError(`${item.name} is already in this workout.`);
    return;
  }
  list.value = [...list.value, defaultPrescription(item, plan.current)];
  openIndex.value = list.value.length - 1;
  view.value = "edit";
}

function startSwap(index: number) {
  swapIndex.value = index;
  view.value = "swap";
}

/** The new exercise keeps the sets and rest; a hold or a lift takes its own kind of target. */
function swapTo(id: string) {
  const index = swapIndex.value;
  const item = byId.value.get(id);
  if (index == null || !item || !plan.current) return;
  const before = list.value[index];
  if (list.value.some((each, at) => at !== index && each.exerciseId === id)) {
    toastError(`${item.name} is already in this workout.`);
    return;
  }
  const fresh = defaultPrescription(item, plan.current);
  const sameKind = measureOf(before.exerciseId) === prescribedBy(item.measure);
  // A swap stays in its circuit, with the circuit's rest.
  const circuit = { superset: before.superset, format: before.format, ...(inCircuit(index) ? { restSeconds: before.restSeconds } : {}) };
  update(index, sameKind ? { ...before, exerciseId: id } : { ...fresh, sets: before.sets, ...circuit });
  toast(`Swapped ${nameOf(before.exerciseId)} for ${item.name}`);
  view.value = "edit";
  swapIndex.value = null;
}

async function save() {
  const current = source.value;
  if (!current || !canSave.value) return;
  const error = await savePlanWorkout(current.id, list.value, renamed.value ? cleanName.value : undefined);
  if (error) {
    toastError(error);
    return;
  }
  closeSheet();
  toast(`Saved ${cleanName.value}`);
}

function back() {
  view.value = "edit";
  swapIndex.value = null;
}
</script>

<template>
  <BottomSheet :open="open" :label="title" full @close="closeSheet">
    <template #header>
      <div v-if="view !== 'edit'" class="row hdr">
        <button type="button" class="cbtn" :aria-label="`Back to ${source?.name ?? 'the workout'}`" @click="back"><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">{{ title }}</h2>
      </div>
      <div v-else class="row hdr">
        <span class="col grow g2">
          <h2 class="t-head m0">{{ title }}</h2>
          <span class="t-capn c2" data-plan-workout-summary>{{ summary }}</span>
        </span>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <ExerciseBrowser v-if="view === 'add'" title="Exercises" title-id="plan-add-title" action="add" @pick="add" />
    <SwapList v-else-if="view === 'swap' && swapIndex != null" :key="list[swapIndex].exerciseId" :exercise-id="list[swapIndex].exerciseId" @pick="swapTo" />

    <div v-else class="col body" data-plan-workout-editor>
      <label class="field row">
        <span class="t-label c2">Name</span>
        <input v-model="name" class="t-body grow nfield" type="text" :maxlength="MAX_NAME" autocomplete="off" enterkeyhint="done" aria-label="Workout name" data-no-autofocus data-plan-workout-name />
      </label>
      <p v-if="!list.length" class="t-label c2 m0" data-plan-workout-empty>No exercises yet. Add the first one, then set its sets, reps and rest.</p>
      <p v-else class="t-capn c2 m0">Changes apply from the next time you start this workout.<template v-if="plan.current?.split !== 'custom'"> Remaking the plan from its answers puts back the suggested exercises.</template></p>
      <ol class="col list" aria-label="Exercises">
        <li v-for="(item, index) in list" :key="item.exerciseId" class="card inset pe" :data-plan-exercise="item.exerciseId" :data-open="openIndex === index ? '' : undefined">
          <button type="button" class="row phead" :aria-expanded="openIndex === index" @click="openIndex = openIndex === index ? null : index">
            <span class="col grow g2">
              <span class="t-body pname">{{ nameOf(item.exerciseId) }}</span>
              <span class="t-capn c2" data-plan-exercise-line>{{ line(item, index) }}</span>
            </span>
            <Icon name="down" :size="16" class="c3 chev" :class="{ flip: openIndex === index }" />
          </button>

          <div v-if="openIndex === index" class="col pbody">
            <div class="row stepper">
              <span class="t-label c2 grow">Sets</span>
              <span class="row steps">
                <button type="button" class="cbtn" aria-label="One set less" :disabled="item.sets <= 1" @click="update(index, stepSets(item, -1))"><Icon name="minus" :size="16" /></button>
                <span class="t-ns val" aria-live="polite" data-plan-sets>{{ item.sets }}</span>
                <button type="button" class="cbtn" aria-label="One set more" :disabled="item.sets >= MAX_SETS" @click="update(index, stepSets(item, 1))"><Icon name="plus" :size="16" /></button>
              </span>
            </div>
            <template v-if="measureOf(item.exerciseId) === 'reps'">
              <div class="row stepper">
                <span class="t-label c2 grow">Reps, at least</span>
                <span class="row steps">
                  <button type="button" class="cbtn" aria-label="Fewer reps at least" :disabled="(item.repMin ?? 1) <= 1" @click="update(index, stepReps(item, 'low', -1))"><Icon name="minus" :size="16" /></button>
                  <span class="t-ns val" aria-live="polite" data-plan-rep-min>{{ item.repMin }}</span>
                  <button type="button" class="cbtn" aria-label="More reps at least" :disabled="(item.repMin ?? 0) >= MAX_REPS" @click="update(index, stepReps(item, 'low', 1))"><Icon name="plus" :size="16" /></button>
                </span>
              </div>
              <div class="row stepper">
                <span class="t-label c2 grow">Reps, at most</span>
                <span class="row steps">
                  <button type="button" class="cbtn" aria-label="Fewer reps at most" :disabled="(item.repMax ?? 1) <= 1" @click="update(index, stepReps(item, 'high', -1))"><Icon name="minus" :size="16" /></button>
                  <span class="t-ns val" aria-live="polite" data-plan-rep-max>{{ item.repMax }}</span>
                  <button type="button" class="cbtn" aria-label="More reps at most" :disabled="(item.repMax ?? 0) >= MAX_REPS" @click="update(index, stepReps(item, 'high', 1))"><Icon name="plus" :size="16" /></button>
                </span>
              </div>
            </template>
            <div v-else-if="measureOf(item.exerciseId) === 'seconds'" class="row stepper">
              <span class="t-label c2 grow">Hold</span>
              <span class="row steps">
                <button type="button" class="cbtn" aria-label="15 seconds less hold" :disabled="(item.seconds ?? 0) <= MIN_SECONDS" @click="update(index, stepSeconds(item, -1))"><Icon name="minus" :size="16" /></button>
                <span class="t-ns val" aria-live="polite" data-plan-hold>{{ clock(item.seconds ?? 0) }}</span>
                <button type="button" class="cbtn" aria-label="15 seconds more hold" :disabled="(item.seconds ?? 0) >= MAX_SECONDS" @click="update(index, stepSeconds(item, 1))"><Icon name="plus" :size="16" /></button>
              </span>
            </div>
            <div class="row stepper">
              <span class="t-label c2 grow">Rest</span>
              <span class="row steps">
                <button type="button" class="cbtn" aria-label="15 seconds less rest" :disabled="item.restSeconds <= 0" @click="update(index, stepRest(item, -1))"><Icon name="minus" :size="16" /></button>
                <span class="t-ns val" aria-live="polite" data-plan-rest>{{ clock(item.restSeconds) }}</span>
                <button type="button" class="cbtn" aria-label="15 seconds more rest" :disabled="item.restSeconds >= MAX_REST" @click="update(index, stepRest(item, 1))"><Icon name="plus" :size="16" /></button>
              </span>
            </div>
            <div class="row acts">
              <button type="button" class="cbtn" :aria-label="`Move ${nameOf(item.exerciseId)} up`" :disabled="index === 0" @click="move(index, -1)"><Icon name="down" :size="18" class="flip" /></button>
              <button type="button" class="cbtn" :aria-label="`Move ${nameOf(item.exerciseId)} down`" :disabled="index === list.length - 1" @click="move(index, 1)"><Icon name="down" :size="18" /></button>
              <span class="row ends">
                <button type="button" class="cbtn" :aria-label="`Swap ${nameOf(item.exerciseId)}`" data-plan-swap @click="startSwap(index)"><Icon name="swap" :size="18" /></button>
                <button type="button" class="cbtn" :aria-label="`Remove ${nameOf(item.exerciseId)}`" :disabled="list.length <= 1" @click="remove(index)"><Icon name="trash" :size="18" /></button>
              </span>
            </div>
          </div>
        </li>
      </ol>
      <button type="button" class="btn sm secondary t-label addbtn" :disabled="list.length >= MAX_EXERCISES" @click="view = 'add'"><Icon name="plus" :size="14" /> Exercise</button>
    </div>

    <template v-if="view === 'edit'" #footer>
      <button type="button" class="btn primary block t-bodys" :disabled="!canSave" data-plan-workout-save @click="save">Save workout</button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: var(--space-2xs); min-width: 0; }
.row.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.body { gap: var(--space-m); padding-top: var(--space-s); }
.list { list-style: none; margin: 0; padding: 0; gap: var(--space-s); }
.pe { padding: 0 var(--space-m); }
.pe .phead { width: 100%; min-height: var(--control-hit); padding-block: var(--space-s); gap: var(--space-s); background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.pname { overflow-wrap: anywhere; }
.chev { flex: none; transition: transform .15s; }
.flip { transform: rotate(180deg); }
.pbody { gap: var(--space-s); padding-bottom: var(--space-m); }
/* As the plan setup's time stepper: at the largest text size the buttons and value move under the label together. */
.stepper { gap: var(--space-s); flex-wrap: wrap; }
.pe .steps { gap: var(--space-s); flex-wrap: nowrap; flex: none; margin-inline-start: auto; }
/* Wide enough for "10:00", so every row's buttons line up. */
.val { min-width: calc(var(--control-hit) * 1.6); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pe .acts { gap: var(--space-s); flex-wrap: nowrap; }
.pe .acts .ends { gap: var(--space-s); margin-left: auto; flex-wrap: nowrap; }
.addbtn { align-self: flex-start; }
.field .nfield { min-width: 0; text-align: right; }
.body .field.row { flex-wrap: nowrap; gap: var(--space-s); }
</style>
