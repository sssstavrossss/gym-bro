<script setup lang="ts">
import { computed, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import SwitchRow from "./SwitchRow.vue";
import { EQUIPMENT, EXPERIENCES, JOINTS, MAX_MINUTES, MIN_MINUTES, MINUTE_STEP, stepMinutes, toggled, type Experience } from "../lib/plan";
import type { TrainingSettings } from "../lib/training";
import { loadPlan, plan } from "../state/plan";
import { saveTraining, training } from "../state/training";
import { closeTraining, toastError, ui } from "../ui";

/**
 * Your training (README → Your training): time, experience, equipment, areas to go easy on, warm-up and
 * cool-down. Every new plan starts from them. Each change shows at once and is saved on the account.
 * Opened from Settings it sits over Settings, so closing goes back there.
 */
const open = computed(() => ui.sheet === "training" || (ui.trainingOver && ui.sheet !== null));
// The sheet under it closed or changed, so this goes with it.
watch(() => ui.sheet, () => { ui.trainingOver = false; });
// Opened away from Train, the plan may not have loaded yet: its answers stand in until these are saved.
watch(open, (shown) => { if (shown && plan.state === "idle") void loadPlan(); });

const answers = computed(() => training.value);

async function change(next: Partial<TrainingSettings>) {
  const error = await saveTraining({ ...answers.value, ...next });
  if (error) toastError(error);
}

function toggleEquipment(id: (typeof EQUIPMENT)[number]["id"]) {
  const next = toggled(answers.value.equipment, id, EQUIPMENT.map((item) => item.id));
  // A plan needs some equipment, so the last one stays on.
  if (next.length) void change({ equipment: next });
}

function toggleJoint(id: (typeof JOINTS)[number]["id"]) {
  void change({ goEasy: toggled(answers.value.goEasy, id, JOINTS.map((item) => item.id)) });
}
</script>

<template>
  <BottomSheet :open="open" label="Your training" @close="closeTraining">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head m0 grow">Your training</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeTraining"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <div class="col setup" data-training-sheet>
      <p class="t-label c2 m0">Every plan you make starts from these. Change them here or in Settings → Training.</p>

      <div class="row stepper">
        <span class="t-label c2 grow">Time per workout</span>
        <span class="row steps">
          <button type="button" class="cbtn" aria-label="5 minutes less" :disabled="answers.minutes <= MIN_MINUTES" @click="change({ minutes: stepMinutes(answers.minutes, -MINUTE_STEP) })"><Icon name="minus" :size="16" /></button>
          <span class="t-ns val" aria-live="polite" data-training-minutes>{{ answers.minutes }} min</span>
          <button type="button" class="cbtn" aria-label="5 minutes more" :disabled="answers.minutes >= MAX_MINUTES" @click="change({ minutes: stepMinutes(answers.minutes, MINUTE_STEP) })"><Icon name="plus" :size="16" /></button>
        </span>
      </div>

      <div class="col g8">
        <span class="t-label c2">Experience</span>
        <Segmented :model-value="answers.experience" label="Experience" :options="EXPERIENCES" @update:model-value="change({ experience: $event as Experience })" />
      </div>

      <div class="col g8">
        <div class="row lrow"><span class="t-label c2 grow">Equipment</span><span class="t-capn c3">pick all you have</span></div>
        <div class="row wrap" role="group" aria-label="Equipment">
          <button
            v-for="item in EQUIPMENT" :key="item.id" type="button" class="chip t-label" :class="{ on: answers.equipment.includes(item.id) }"
            :aria-pressed="answers.equipment.includes(item.id)" @click="toggleEquipment(item.id)"
          ><span>{{ item.label }}</span></button>
        </div>
      </div>

      <div class="col g8">
        <span class="t-label c2">Go easy on</span>
        <div class="row wrap" role="group" aria-label="Go easy on">
          <button
            v-for="item in JOINTS" :key="item.id" type="button" class="chip t-label" :class="{ on: answers.goEasy.includes(item.id) }"
            :aria-pressed="answers.goEasy.includes(item.id)" @click="toggleJoint(item.id)"
          ><span>{{ item.label }}</span></button>
        </div>
      </div>

      <div class="col">
        <SwitchRow title="Mobility warm-up" caption="A few moves for the muscles you'll train, in place of a plain warm-up." :on="answers.warmUp" data-training-warm-up @toggle="change({ warmUp: !answers.warmUp })" />
        <SwitchRow title="Cool-down" caption="A few stretches at the end for the muscles you trained, about 3 minutes." :on="answers.coolDown" data-training-cool-down @toggle="change({ coolDown: !answers.coolDown })" />
      </div>

      <p v-if="plan.current" class="t-capn c2 m0" data-training-plan-note>Your plan keeps the answers it was made with. Edit plan to change it.</p>
      <span class="t-capn c3">Training suggestions, not medical advice.</span>
    </div>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g8 { gap: var(--space-s); }
.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.setup { gap: var(--space-l); }
.lrow { gap: var(--space-s); }
.wrap { flex-wrap: wrap; column-gap: var(--space-s); row-gap: 0; }
/* At the largest text size the buttons and the value move under the label together. */
.stepper { gap: var(--space-s); flex-wrap: wrap; }
.steps { gap: var(--space-s); flex-wrap: nowrap; flex: none; margin-inline-start: auto; }
.val { min-width: var(--control-hit); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
