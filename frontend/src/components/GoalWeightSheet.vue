<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { todayInZone } from "../lib/dates";
import { armReplace } from "../lib/focusField";
import { goalSheetHint, stepWhole } from "../lib/goalCards";
import { goalLine } from "../lib/goalLine";
import { parseDecimal } from "../lib/numbers";
import { dialSpec, weightDial } from "../lib/dial";
import { afterInsertion, markWholeSelection, nextQuickInput, tookWholeSelection } from "../lib/quickEntry";
import { parseWeight, toKg, weightRange, weightRangeError } from "../lib/units";
import { keyboardEntry } from "../lib/viewport";
import { commitProfile, deviceTimeZone, profile } from "../state/profile";
import { weightUnit, wt } from "../state/units";
import { closeSheet, openDial, ui } from "../ui";

/**
 * Goal weight. On a touch screen the number opens the number wheel, like a weigh-in, so a phone never raises its own
 * number pad; with a keyboard the field takes typing.
 */
const open = computed(() => ui.sheet === "goal-weight");
const value = ref("");
const replaceFirst = ref(true);
const input = ref<HTMLInputElement | null>(null);
const figure = ref<HTMLButtonElement | null>(null);
const busy = ref(false);
const localError = ref("");

watch(open, async (isOpen) => {
  if (!isOpen) return;
  value.value = profile.form.goalWeight;
  replaceFirst.value = true;
  localError.value = "";
  if (!keyboardEntry.value) return;
  await nextTick();
  input.value?.focus();
});

/** The typed goal in kilograms, or null when it is not a weight in range. */
const parsed = computed(() => parseWeight(value.value, weightUnit()));
const invalid = computed(() => value.value.trim() !== "" && parsed.value == null);

const trendKg = computed(() => profile.weight?.trendKg ?? profile.weight?.usedKg ?? null);
/** What a goal means from the trend: when it's reached at the rate set. Under the field, and on the wheel as it turns. */
function hintFor(goalKg: number | null) {
  const line = goalLine({
    goal: profile.form.goal,
    weightKg: trendKg.value,
    goalKg,
    rateKg: parseDecimal(profile.form.rate),
    today: todayInZone(profile.form.timeZone || deviceTimeZone()),
  });
  return goalSheetHint(line, trendKg.value == null ? null : wt(trendKg.value), weightUnit(), wt);
}
const hint = computed(() => hintFor(parsed.value));

function pickGoal() {
  const unit = weightUnit();
  const range = weightRange(unit);
  const spec = dialSpec(weightDial("goal", unit), {
    label: "Goal weight",
    value: parseDecimal(value.value),
    min: Number(range.min),
    max: Number(range.max),
    live: (shown) => hintFor(toKg(shown, unit)),
  });
  openDial(spec, figure.value, (picked) => {
    value.value = String(picked);
    replaceFirst.value = true;
    localError.value = "";
  });
}

function nudge(step: -1 | 1) {
  const base = parseDecimal(value.value) ?? parseDecimal(profile.form.goalWeight);
  if (base == null) return;
  const range = weightRange(weightUnit());
  value.value = String(stepWhole(base, step, Math.ceil(Number(range.min)), Math.floor(Number(range.max))));
  replaceFirst.value = true;
  localError.value = "";
}

function onFocus(event: FocusEvent) {
  replaceFirst.value = true;
  if (event.target instanceof HTMLInputElement) armReplace(event.target);
}

function onInput(event: Event) {
  const field = event.target as HTMLInputElement;
  const replace = replaceFirst.value;
  afterInsertion(field, (raw) => {
    const next = nextQuickInput(value.value, raw, replace && !tookWholeSelection(field), 5);
    replaceFirst.value = false;
    localError.value = "";
    value.value = next;
    if (field.value !== next) field.value = next;
  });
}

/** Saves through the profile, like every Goal change. An unchanged goal just closes. */
async function save() {
  if (parsed.value == null || busy.value) return;
  busy.value = true;
  profile.form.goalWeight = value.value;
  const ok = await commitProfile();
  busy.value = false;
  if (!ok) {
    localError.value = profile.error || "Couldn't save the goal weight.";
    return;
  }
  closeSheet();
}
</script>

<template>
  <BottomSheet :open="open" label="Goal weight" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow htitle">Goal weight</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <form class="row wfield" data-goal-weight-sheet @submit.prevent="save">
      <button type="button" class="cbtn" :aria-label="`1 ${weightUnit()} less`" @mousedown.prevent @click="nudge(-1)"><Icon name="minus" :size="18" /></button>
      <component :is="keyboardEntry ? 'label' : 'span'" class="wlabel">
        <span v-if="keyboardEntry" class="autosize">
          <span class="mirror wfig" aria-hidden="true">{{ value || "0" }}</span>
          <input ref="input" data-no-autofocus :value="value" data-replace="1" class="wfig winput" size="1"  inputmode="decimal" enterkeyhint="done" autocomplete="off" :aria-label="`Goal weight in ${weightUnit() === 'lb' ? 'pounds' : 'kilograms'}`" @beforeinput="markWholeSelection" @focus="onFocus" @input="onInput" />
        </span>
        <button
          v-else ref="figure" type="button" class="wfig wpick tnum" :class="{ hinted: !value }" data-goal-pick
          :aria-label="`Goal weight in ${weightUnit() === 'lb' ? 'pounds' : 'kilograms'}, ${value || 'none yet'}, change`" @click="pickGoal"
        >{{ value || "—" }}</button>
        <span class="t-head c2">{{ weightUnit() }}</span>
      </component>
      <button type="button" class="cbtn" :aria-label="`1 ${weightUnit()} more`" @mousedown.prevent @click="nudge(1)"><Icon name="plus" :size="18" /></button>
    </form>
    <p v-if="invalid || localError" class="t-label m0" role="alert">{{ localError || weightRangeError("Goal weight", weightUnit()) }}</p>
    <p v-else-if="hint" class="t-capn c2 m0" aria-live="polite" data-goal-hint>{{ hint }}</p>
    <template #footer>
      <div class="wfoot" @mousedown.prevent>
        <button type="button" class="btn primary block t-bodys" :disabled="parsed === null || busy" @click="save">Save</button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.htitle { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.m0 { margin: 0; }
/* The same big number as the weight sheet: − and + at the edges, the number in the middle. */
/* The same box as the amount screens, around the number and its − and + buttons. */
.wfield { gap: var(--space-s); align-items: center; justify-content: space-between; padding: 10px var(--space-m); border-radius: var(--radius-l); background: var(--color-surface-2); box-shadow: var(--d-sunk); }
.wlabel { display: inline-flex; align-items: baseline; justify-content: center; gap: var(--space-s); min-width: 0; flex: 0 1 auto; }
.autosize { display: inline-grid; min-height: 44px; }
.autosize > * { grid-area: 1 / 1; }
.mirror { visibility: hidden; white-space: pre; padding: 0 calc(var(--space-xs) + 0.08em) 0 var(--space-xs); }
.wfig { font-size: min(3rem, 64px); line-height: 1.1; font-weight: 700; letter-spacing: -0.03em; }
.winput {
  width: 0; min-width: 100%; min-height: 44px; background: transparent;
  border: 0; outline: none; box-shadow: none; padding: 0 var(--space-xs); border-radius: var(--radius-m);
  caret-color: var(--text-primary); font-size: min(3rem, 64px); color: var(--text-primary);
}
.winput:focus, .winput:focus-visible { outline: none; border: 0; box-shadow: var(--d-sunk); background: var(--color-surface-2); }
.wpick { min-height: 44px; padding: 0 var(--space-xs); border: 0; border-radius: var(--radius-m); background: none; color: var(--text-primary); white-space: nowrap; }
.wpick.hinted { color: var(--text-tertiary); }
.wpick:active { background: var(--color-hover); }
.tnum { font-variant-numeric: tabular-nums; }
.wfoot { display: flex; flex-direction: column; gap: var(--space-m); }
</style>
