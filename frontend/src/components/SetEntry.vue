<script setup lang="ts">
import { computed, watch } from "vue";
import Icon from "./Icon.vue";
import Keypad from "./Keypad.vue";
import type { CellEdit } from "./WorkoutExercise.vue";
import { keyboardEntry } from "../lib/viewport";
import { clock, FIELD_LABELS, fieldDecimals, fieldText, measureFields, parseField, secondsDigits, setHints, typeKey, type DraftExercise, type SetField } from "../lib/workout";
import { sameAs, setName, stepped } from "../lib/setEntry";
import { loadStep } from "../lib/progression";
import { addSet, exerciseItem, exerciseSuggestion, setValue, shiftRest, toggleDone, workout } from "../state/workout";

// The exercise screen's footer: the next set's fields, quick fills, the keypad, and Log set. Like the amount
// screen's tray, it types straight into the set; Log ticks it off, taking the grey hints for any field left empty.
/** `left`: the rest's seconds left while it runs (0 once it's over), else null. */
const props = defineProps<{ exercise: DraftExercise; target: number; edit: CellEdit; left: number | null }>();
const emit = defineEmits<{ logged: []; done: []; next: [] }>();

const item = computed(() => exerciseItem(props.exercise.exerciseId));
const measure = computed(() => item.value?.measure ?? "weight_reps");
const fields = computed(() => measureFields(measure.value));
const lastSets = computed(() => workout.previous[props.exercise.exerciseId]?.sets ?? []);
const set = computed(() => props.exercise.sets[props.target] ?? null);
const hints = computed(() => setHints(props.exercise, props.target, lastSets.value, exerciseSuggestion(props.exercise)));
const name = computed(() => setName(props.exercise.sets, props.target));
const logged = computed(() => !!set.value?.doneAt);

/** The field the keypad types into, starting on the first, for every new set. */
function aim(field: SetField = fields.value[0]) {
  const value = set.value?.[field] ?? null;
  Object.assign(props.edit, { key: props.exercise.key, index: props.target, field, text: field === "seconds" ? secondsDigits(value) : fieldText(field, value), fresh: true });
}
watch(() => [props.exercise.key, props.target, props.exercise.sets.length] as const, () => aim(), { immediate: true });

/** The set one past the last exists once something is typed into it. */
function ensure() {
  if (props.target >= props.exercise.sets.length) addSet(props.exercise.key);
}

const editing = (field: SetField) => props.edit.key === props.exercise.key && props.edit.index === props.target && props.edit.field === field;
const shownText = (field: SetField) => (editing(field) && !props.edit.fresh ? props.edit.text : fieldText(field, set.value?.[field] ?? null));

function onFocus(event: FocusEvent, field: SetField) {
  aim(field);
  if (keyboardEntry.value) (event.target as HTMLInputElement).select();
}

function onInput(event: Event, field: SetField) {
  const input = event.target as HTMLInputElement;
  const value = parseField(field, input.value);
  if (value === undefined) {
    input.value = props.edit.text;
    return;
  }
  ensure();
  Object.assign(props.edit, { field, text: input.value, fresh: false });
  setValue(props.exercise.key, props.target, field, value);
}

function padKey(key: string) {
  const field = props.edit.field;
  const start = props.edit.fresh && key !== "⌫" ? "" : props.edit.fresh ? shownText(field) : props.edit.text;
  ensure();
  props.edit.fresh = false;
  props.edit.text = typeKey(start, key, field);
  setValue(props.exercise.key, props.target, field, parseField(field, props.edit.text) ?? null);
}

/** Next moves the keypad along the fields, then wraps to the first. */
function nextField() {
  const at = fields.value.indexOf(props.edit.field);
  aim(fields.value[(at + 1) % fields.value.length]);
}

const same = computed(() => sameAs(props.exercise, props.target, lastSets.value, measure.value));
function fillSame() {
  const values = same.value?.values;
  if (!values) return;
  ensure();
  for (const field of fields.value) setValue(props.exercise.key, props.target, field, values[field]);
  aim(props.edit.field);
}
/** A step of the kit (2.5 kg on a bar, 2 kg for dumbbells), on what the field shows. */
const step = computed(() => (fields.value.includes("kg") ? loadStep(item.value?.equipment) ?? 2.5 : null));
function bump(delta: number) {
  ensure();
  setValue(props.exercise.key, props.target, "kg", stepped("kg", set.value?.kg ?? hints.value.kg, delta));
  aim("kg");
}

function log() {
  if (logged.value) {
    emit("next");
    return;
  }
  ensure();
  toggleDone(props.exercise.key, props.target);
  emit("logged");
}
</script>

<template>
  <div class="col entry" @mousedown="($event.target as HTMLElement).closest('input') ? undefined : $event.preventDefault()">
    <div class="row chips">
      <!-- The rest leads the quick fills, as a chip: tapping it skips the rest (or clears "Rest over"). -->
      <button
        v-if="left != null" type="button" class="chip on t-label tnum" :aria-label="left ? `Skip the rest, ${clock(left)} left` : 'Rest over. OK'"
        data-rest @click="shiftRest(null)"
      ><Icon name="clock" :size="14" /><span>{{ left ? "Rest" : "Rest over" }}</span><span v-if="left" role="timer" aria-live="off">{{ clock(left) }}</span><span class="dim">· {{ left ? "Skip" : "OK" }}</span></button>
      <button v-if="same" type="button" class="chip t-label" data-same-as @click="fillSame">{{ same.label }}</button>
      <template v-if="step">
        <button type="button" class="chip t-label tnum" :aria-label="`${step} kg less`" @click="bump(-step)">−{{ step }} kg</button>
        <button type="button" class="chip t-label tnum" :aria-label="`${step} kg more`" @click="bump(step)">+{{ step }} kg</button>
      </template>
    </div>
    <div class="row flds">
      <label v-for="field in fields" :key="field" class="col fld" :class="{ on: editing(field) && !keyboardEntry }">
        <span class="t-capn c2">{{ FIELD_LABELS[field] }}</span>
        <input
          class="t-ns val" :value="shownText(field)" :placeholder="fieldText(field, hints[field])"
          :inputmode="keyboardEntry ? (field === 'kg' || field === 'metres' ? 'decimal' : 'numeric') : 'none'"
          enterkeyhint="done" autocomplete="off" data-no-autofocus :data-cell="`${exercise.key}-${target}-${field}`"
          :aria-label="`${name}, ${FIELD_LABELS[field]}`" @focus="onFocus($event, field)" @input="onInput($event, field)" @keydown.enter="log"
        />
      </label>
    </div>
    <template v-if="!keyboardEntry">
      <Keypad :decimal="fieldDecimals(edit.field) > 0" @key="padKey" />
    </template>
    <div class="row acts">
      <button v-if="!keyboardEntry" type="button" class="btn secondary t-bodys" @click="nextField">Next</button>
      <button type="button" class="btn secondary t-bodys" data-exercise-done @click="emit('done')">Done</button>
      <button type="button" class="btn primary t-bodys fill" :disabled="workout.saving" data-log-set @click="log">
        <template v-if="logged">Next set</template>
        <template v-else><Icon name="check" :size="16" :sw="2.6" /> Log {{ name.toLowerCase() }}</template>
      </button>
    </div>
  </div>
</template>

<style scoped>
.entry { gap: var(--space-s); }
.row.chips {
  flex-wrap: nowrap; gap: var(--space-xs); overflow-x: auto; scrollbar-width: none;
  margin-inline: calc(-1 * var(--space-screen)); padding-inline: var(--space-screen);
}
.chips::-webkit-scrollbar { display: none; }
.chips .chip { flex: none; }
.chips:empty { display: none; }
.tnum { font-variant-numeric: tabular-nums; }
.dim { opacity: .7; }
.row.flds { gap: var(--space-s); flex-wrap: nowrap; }
.fld { flex: 1 1 0; min-width: 0; gap: var(--space-2xs); padding: var(--space-xs) var(--space-m); border-radius: var(--radius-m); background: var(--color-surface-2); }
.fld.on { box-shadow: inset 0 0 0 2px var(--color-action); }
.val {
  width: 100%; min-width: 0; padding: 0; border: 0; background: none; color: var(--text-primary); font-variant-numeric: tabular-nums;
  caret-color: var(--text-primary);
}
.val::placeholder { color: var(--text-tertiary); opacity: 1; }
.val:focus { outline: none; }
.fld:focus-within { box-shadow: inset 0 0 0 2px var(--color-action); }
.row.acts { gap: var(--space-s); flex-wrap: nowrap; }
.acts .fill { flex: 1 1 0; min-width: 0; }
html.dt-xl .row.acts { flex-wrap: wrap; }
html.dt-xl .acts .fill { flex-basis: 100%; }
</style>
