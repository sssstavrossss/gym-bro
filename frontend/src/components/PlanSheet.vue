<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import Segmented from "./Segmented.vue";
import SwitchRow from "./SwitchRow.vue";
import { previewPlan } from "../api";
import {
  answersOf,
  defaultAnswers,
  droppedOwn,
  easeInFor,
  EQUIPMENT,
  EXPERIENCES,
  GOALS,
  JOINTS,
  MAX_MINUTES,
  MIN_MINUTES,
  MINUTE_STEP,
  previewSummary,
  remakes,
  splitFor,
  splitsFor,
  stepMinutes,
  toggled,
  WEEKDAYS,
  type PlanAnswers,
  type PlanPreview,
  type Split,
} from "../lib/plan";
import { endPlan, plan, savePlan } from "../state/plan";
import { closeSheet, toast, toastError, ui } from "../ui";

// New plan / Edit plan (docs/training.md, decision 3 and 8). The server makes the workouts; the preview shows
// what the answers make before anything is saved.
const open = computed(() => ui.sheet === "plan");
const editing = computed(() => plan.current != null);
const answers = ref<PlanAnswers>(defaultAnswers());
/** Not stored: a yes only shows the note to check with a doctor first. */
const heart = ref<"" | "no" | "yes">("");
const choosingSplit = ref(false);
const confirmingEnd = ref(false);
const preview = ref<PlanPreview | null>(null);
const previewState = ref<"loading" | "ready" | "failed">("loading");

watch(open, (shown) => {
  if (!shown) return;
  answers.value = plan.current ? answersOf(plan.current) : { ...defaultAnswers(), split: ui.planOwn ? "custom" : null };
  heart.value = "";
  choosingSplit.value = !plan.current && ui.planOwn;
  confirmingEnd.value = false;
});

// The preview follows the answers, a moment after the last change.
let previewTimer: number | undefined;
let previewSeq = 0;
watch([open, answers], ([shown]) => {
  window.clearTimeout(previewTimer);
  if (!shown) return;
  previewTimer = window.setTimeout(refreshPreview, 250);
}, { deep: true });

async function refreshPreview() {
  const seq = ++previewSeq;
  if (!answers.value.weekdays.length || !answers.value.equipment.length) {
    previewState.value = "ready";
    preview.value = null;
    return;
  }
  if (!preview.value) previewState.value = "loading";
  try {
    const made = await previewPlan(answers.value);
    if (seq !== previewSeq) return;
    preview.value = made;
    previewState.value = "ready";
  } catch {
    if (seq === previewSeq) previewState.value = "failed";
  }
}

const split = computed(() => answers.value.split ?? splitFor(answers.value.weekdays.length, answers.value.goal));
const splits = computed(() => splitsFor(answers.value.goal));
// Hyrox has its own split: a split picked by hand that the new goal can't take goes back to the goal's own.
watch(() => answers.value.goal, (goal) => {
  if (answers.value.split && !splitsFor(goal).some((item) => item.id === answers.value.split)) answers.value.split = null;
});
const summary = computed(() => (preview.value ? previewSummary(preview.value) : null));
const easeIn = computed(() => easeInFor(answers.value));
/** Saving remakes every workout from the answers, so hand edits go. */
const editedNames = computed(() =>
  remakes(plan.current, split.value) ? (plan.current?.workouts ?? []).filter((item) => item.edited).map((item) => item.name) : []);
/** Your own plan with fewer days: the last workouts go. */
const dropped = computed(() => droppedOwn(plan.current, split.value, answers.value.weekdays.length));
const missing = computed(() =>
  !answers.value.weekdays.length ? "Pick at least one day." : !answers.value.equipment.length ? "Pick the equipment you have." : "");

function toggleDay(day: number) {
  answers.value.weekdays = toggled(answers.value.weekdays, day, [0, 1, 2, 3, 4, 5, 6]);
  // The split follows the days until one is picked by hand.
}

function toggleEquipment(id: (typeof EQUIPMENT)[number]["id"]) {
  answers.value.equipment = toggled(answers.value.equipment, id, EQUIPMENT.map((item) => item.id));
}

function toggleJoint(id: (typeof JOINTS)[number]["id"]) {
  answers.value.goEasy = toggled(answers.value.goEasy, id, JOINTS.map((item) => item.id));
}

function pickSplit(id: Split) {
  answers.value.split = id === splitFor(answers.value.weekdays.length, answers.value.goal) ? null : id;
}

async function save() {
  if (missing.value || plan.saving) return;
  const wasEditing = editing.value;
  const error = await savePlan(answers.value);
  if (error) {
    toastError(error);
    return;
  }
  closeSheet();
  toast(wasEditing ? "Plan saved" : "Plan made");
}

async function end() {
  const error = await endPlan();
  if (error) {
    toastError(error);
    return;
  }
  closeSheet();
  toast("Plan ended");
}
</script>

<template>
  <BottomSheet :open="open" :label="editing ? 'Edit plan' : 'New plan'" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head m0 grow">{{ editing ? "Edit plan" : "New plan" }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <div class="col setup" data-plan-setup>
      <div class="col g8">
        <span id="plan-goal" class="t-label c2">Goal</span>
        <Segmented v-model="answers.goal" label="Goal" :options="GOALS" />
      </div>

      <div class="col g8">
        <div class="row lrow"><span class="t-label c2 grow">Days a week</span><span class="t-capn c3">to date your workouts</span></div>
        <div class="row wdays" role="group" aria-label="Days a week">
          <button
            v-for="(day, index) in WEEKDAYS" :key="day" type="button" class="chip t-label wday" :class="{ on: answers.weekdays.includes(index) }"
            :aria-pressed="answers.weekdays.includes(index)" :aria-label="day" @click="toggleDay(index)"
          ><span>{{ day[0] }}</span></button>
        </div>
      </div>

      <div class="row stepper">
        <span class="t-label c2 grow">Time per workout</span>
        <span class="row steps">
        <button type="button" class="cbtn" aria-label="5 minutes less" :disabled="answers.minutes <= MIN_MINUTES" @click="answers.minutes = stepMinutes(answers.minutes, -MINUTE_STEP)"><Icon name="minus" :size="16" /></button>
        <span class="t-ns val" aria-live="polite" data-plan-minutes>{{ answers.minutes }} min</span>
        <button type="button" class="cbtn" aria-label="5 minutes more" :disabled="answers.minutes >= MAX_MINUTES" @click="answers.minutes = stepMinutes(answers.minutes, MINUTE_STEP)"><Icon name="plus" :size="16" /></button>
        </span>
      </div>

      <div class="col g8">
        <span class="t-label c2">Experience</span>
        <Segmented v-model="answers.experience" label="Experience" :options="EXPERIENCES" />
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

      <section class="col g8" aria-labelledby="plan-before">
        <h3 id="plan-before" class="t-cap c3 section-title m0">Before you start</h3>
        <div class="col g8">
          <span id="plan-heart" class="t-label">Has a doctor told you about a heart condition, or do you get chest pain, faintness or dizziness when active?</span>
          <div class="row wrap" role="radiogroup" aria-labelledby="plan-heart">
            <button v-for="option in (['no', 'yes'] as const)" :key="option" type="button" role="radio" class="chip t-label" :class="{ on: heart === option }" :aria-checked="heart === option" @click="heart = option">
              <span>{{ option === "no" ? "No" : "Yes" }}</span>
            </button>
          </div>
          <p v-if="heart === 'yes'" class="well t-label m0" role="status">Check with a doctor before you start training. You can still make a plan and start gently.</p>
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
        <SwitchRow title="Ease in" caption="The first 2 weeks stop further from failure, with smaller load steps." :on="easeIn" @toggle="answers.easeIn = !easeIn" />
        <span class="t-capn c3">Training suggestions, not medical advice.</span>
      </section>

      <div class="well col g4" data-plan-preview aria-live="polite">
        <template v-if="missing">
          <span class="t-bodys">{{ missing }}</span>
          <span class="t-capn c2">The plan shows here.</span>
        </template>
        <template v-else-if="summary">
          <span class="t-bodys">{{ summary.title }}</span>
          <span class="t-capn c2">{{ preview!.workouts.map((workout) => workout.name).join(" → ") }}</span>
          <span class="t-capn c2">{{ summary.line }}</span>
        </template>
        <template v-else-if="previewState === 'failed'">
          <span class="t-bodys">Couldn't show the plan</span>
          <span class="t-capn c2">Making a plan needs a connection.</span>
        </template>
        <template v-else>
          <span class="t-bodys">Making your plan…</span>
          <span class="t-capn c2">&nbsp;</span>
        </template>
        <button type="button" class="btn sm secondary t-label splitbtn" :aria-expanded="choosingSplit" @click="choosingSplit = !choosingSplit">Change split</button>
        <div v-if="choosingSplit" class="row wrap" role="radiogroup" aria-label="Split">
          <button
            v-for="item in splits" :key="item.id" type="button" role="radio" class="chip t-label" :class="{ on: split === item.id }"
            :aria-checked="split === item.id" @click="pickSplit(item.id)"
          ><span>{{ item.label }}</span></button>
        </div>
      </div>

      <p v-if="editedNames.length" class="well t-label m0" data-plan-edits-note>
        Saving remakes the workouts from these answers. Your changes to {{ editedNames.join(", ") }} won't be kept.
      </p>
      <p v-else-if="dropped.length" class="well t-label m0" data-plan-drops-note>
        With {{ answers.weekdays.length === 1 ? "1 day" : `${answers.weekdays.length} days` }}, saving drops {{ dropped.join(", ") }} from your plan.
      </p>

      <div v-if="editing" class="col g8 endwrap">
        <div v-if="confirmingEnd" class="card outline col confirm" role="alertdialog" aria-labelledby="pe-h" aria-describedby="pe-d">
          <h3 id="pe-h" class="t-head m0">End your plan?</h3>
          <p id="pe-d" class="t-label c2 m0">Workouts you've done stay in History.</p>
          <div class="row cbtns">
            <button type="button" class="btn sm secondary t-label" @click="end">End plan</button>
            <button type="button" class="btn sm primary t-label" @click="confirmingEnd = false">Keep it</button>
          </div>
        </div>
        <button v-else type="button" class="btn sm secondary t-label endbtn" @click="confirmingEnd = true"><Icon name="trash" :size="14" /> End plan</button>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn primary block t-bodys" :disabled="!!missing || plan.saving" data-plan-save @click="save">
        {{ editing ? "Save plan" : "Create plan" }}
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g4 { gap: var(--space-xs); }
.g8 { gap: var(--space-s); }
.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.setup { gap: var(--space-l); }
.lrow { gap: var(--space-s); }
.wrap { flex-wrap: wrap; column-gap: var(--space-s); row-gap: 0; }
.wdays { gap: var(--space-2xs); flex-wrap: nowrap; }
.wday { flex: 1 1 0; min-width: 0; padding-inline: 0; }
/* At the largest text size the buttons and the value move under the label together. */
.stepper { gap: var(--space-s); flex-wrap: wrap; }
.steps { gap: var(--space-s); flex-wrap: nowrap; flex: none; margin-inline-start: auto; }
.val { min-width: var(--control-hit); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
.splitbtn, .endbtn { align-self: flex-start; }
.confirm { gap: var(--space-s); }
.cbtns { gap: var(--space-s); }
</style>
