<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import PlanWeek from "./PlanWeek.vue";
import Segmented from "./Segmented.vue";
import SwitchRow from "./SwitchRow.vue";
import { previewPlan } from "../api";
import {
  answersOf,
  defaultAnswers,
  droppedOwn,
  easeInFor,
  GOALS,
  previewSummary,
  remakes,
  splitFor,
  splitsFor,
  toggled,
  WEEKDAYS,
  workoutChangeLines,
  workoutChanges,
  type PlanAnswers,
  type PlanPreview,
  type Split,
} from "../lib/plan";
import { trainingChanges, trainingFrom, usingLine, withTraining } from "../lib/training";
import { exercises, loadExercises } from "../state/exercises";
import { endPlan, plan, planDraft, savePlan } from "../state/plan";
import { training } from "../state/training";
import { closeSheet, openTraining, toast, toastError, ui } from "../ui";

// New plan / Edit plan (docs/training.md, decision 3 and 8). The server makes the workouts; the preview shows
// what the answers make before anything is saved.
const open = computed(() => ui.sheet === "plan");
const editing = computed(() => plan.current != null);
const answers = ref<PlanAnswers>(defaultAnswers());
const choosingSplit = ref(false);
const confirmingEnd = ref(false);
const preview = ref<PlanPreview | null>(null);
const previewState = ref<"loading" | "ready" | "failed">("loading");

/** A new plan: its goal and days from Train's card, the rest from Your training. */
function newAnswers(split: Split | null): PlanAnswers {
  return { ...withTraining(defaultAnswers(), training.value), goal: planDraft.goal, weekdays: [...planDraft.weekdays], split };
}

watch(open, (shown) => {
  if (!shown) return;
  // Goal, days, Ease in and the split are the plan's own; the rest is Your training, and saving brings the plan up to it.
  answers.value = plan.current ? withTraining(answersOf(plan.current), training.value) : newAnswers(ui.planSplit);
  choosingSplit.value = false;
  confirmingEnd.value = false;
  reviewing.value = editing.value && ui.planUpdate;
  if (reviewing.value) void loadExercises();
});
// Your training opens over the sheet from its line; the plan follows what changes there.
watch(training, () => {
  if (!open.value) return;
  answers.value = editing.value ? withTraining(answers.value, training.value) : newAnswers(answers.value.split);
});
/** Your training changed after the plan was made: saving brings the plan up to it. */
const changes = computed(() => (plan.current ? trainingChanges(trainingFrom(answersOf(plan.current)), training.value) : []));
const trainingChanged = computed(() => changes.value.length > 0);

/** Update plan: what the changes do, side by side, before saving; Edit plan goes to the full setup. */
const reviewing = ref(false);
const nameOf = (id: string) => exercises.items.find((item) => item.id === id)?.name ?? id;
const workoutDiffs = computed(() =>
  plan.current && preview.value ? workoutChanges(plan.current.workouts, preview.value.workouts).map((change) => ({ ...change, lines: workoutChangeLines(change, nameOf) })) : []);

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

const title = computed(() => (reviewing.value ? "Update plan" : editing.value ? "Edit plan" : "New plan"));
const split = computed(() => answers.value.split ?? splitFor(answers.value.weekdays.length, answers.value.goal));
const splits = computed(() => splitsFor(answers.value.goal));
// Hyrox has its own split: a split picked by hand that the new goal can't take goes back to the goal's own.
watch(() => answers.value.goal, (goal) => {
  if (answers.value.split && !splitsFor(goal).some((item) => item.id === answers.value.split)) answers.value.split = null;
});
const summary = computed(() => (preview.value ? previewSummary(preview.value) : null));
const easeIn = computed(() => easeInFor(answers.value));
/** Saving remakes every workout from the answers, so hand edits go (not when only the warm-up or cool-down changes). */
const editedNames = computed(() =>
  remakes(plan.current, split.value, answers.value) ? (plan.current?.workouts ?? []).filter((item) => item.edited).map((item) => item.name) : []);
/** Your own plan with fewer days: the last workouts go. */
const dropped = computed(() => droppedOwn(plan.current, split.value, answers.value.weekdays.length));
const missing = computed(() =>
  !answers.value.weekdays.length ? "Pick at least one day." : !answers.value.equipment.length ? "Pick the equipment you have." : "");

/** The split follows the days until one is picked by hand. A plan needs a day, so the last one stays on. */
function toggleDay(day: number) {
  const next = toggled(answers.value.weekdays, day, [0, 1, 2, 3, 4, 5, 6]);
  if (next.length) answers.value.weekdays = next;
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
  const updated = reviewing.value;
  closeSheet();
  toast(updated ? "Plan updated" : wasEditing ? "Plan saved" : "Plan made");
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
  <BottomSheet :open="open" :label="title" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head m0 grow">{{ title }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <!-- A new plan: what it makes, before it starts. Goal and days come from Train's card, the rest from Your training. -->
    <div v-if="!editing" class="col setup" data-plan-new>
      <div class="col g16" data-plan-preview aria-live="polite">
        <PlanWeek v-if="preview && previewState === 'ready'" :preview="preview" :weekdays="answers.weekdays" :minutes="answers.minutes" />
        <div v-else class="well col g4">
          <template v-if="previewState === 'failed'">
            <span class="t-bodys">Couldn't show the plan</span>
            <span class="t-capn c2">Making a plan needs a connection.</span>
          </template>
          <template v-else>
            <span class="t-bodys">Making your plan…</span>
            <span class="t-capn c2">&nbsp;</span>
          </template>
        </div>
      </div>

      <button type="button" class="row using" :aria-label="`Your training: ${usingLine(training)}. Change`" data-plan-using @click="openTraining">
        <Icon name="user" :size="16" class="c2" />
        <span class="t-label c2 grow">{{ usingLine(training) }}</span>
        <Icon name="edit" :size="14" class="c3" />
      </button>

      <div class="col g8">
        <button type="button" class="btn sm secondary t-label splitbtn" :aria-expanded="choosingSplit" @click="choosingSplit = !choosingSplit">Change split</button>
        <div v-if="choosingSplit" class="row wrap" role="radiogroup" aria-label="Split">
          <button
            v-for="item in splits" :key="item.id" type="button" role="radio" class="chip t-label" :class="{ on: split === item.id }"
            :aria-checked="split === item.id" @click="pickSplit(item.id)"
          ><span>{{ item.label }}</span></button>
        </div>
      </div>

      <div class="col g4">
        <span class="t-capn c2">If a doctor has told you about a heart condition, or you get chest pain, faintness or dizziness when active, check with them before you start.</span>
        <span class="t-capn c3">Training suggestions, not medical advice.</span>
      </div>
    </div>

    <!-- Update plan: Your training's changes, and what they do to each workout, to confirm. -->
    <div v-else-if="reviewing" class="col setup" data-plan-update>
      <p class="t-label c2 m0">{{ trainingChanged ? "Your training has changed since this plan was made. Updating makes its workouts again from it." : "Your plan is up to date with Your training." }}</p>
      <div v-if="trainingChanged" class="compare" data-plan-update-answers>
        <span class="t-capn c2"></span>
        <span class="t-capn c2">Now</span>
        <span class="t-capn c2">New</span>
        <template v-for="item in changes" :key="item.label">
          <span class="t-label c2">{{ item.label }}</span>
          <span class="t-label">{{ item.now }}</span>
          <span class="t-label">{{ item.next }}</span>
        </template>
      </div>

      <div class="col g4" data-plan-update-workouts aria-live="polite">
        <template v-if="missing">
          <span class="t-bodys">{{ missing }}</span>
        </template>
        <template v-else-if="previewState === 'failed'">
          <span class="t-bodys">Couldn't show the changes</span>
          <span class="t-capn c2">Updating a plan needs a connection.</span>
        </template>
        <template v-else-if="!workoutDiffs.length">
          <span class="t-capn c2">Working out the changes…</span>
        </template>
        <ul v-else class="list diffs">
          <li v-for="item in workoutDiffs" :key="item.name" class="col g2" :data-plan-update-workout="item.name">
            <span class="t-bodys">{{ item.name }}</span>
            <span v-for="line in item.lines" :key="line" class="t-capn c2">{{ line }}</span>
          </li>
        </ul>
      </div>

      <p v-if="editedNames.length" class="well t-label m0" data-plan-edits-note>
        Your changes to {{ editedNames.join(", ") }} won't be kept.
      </p>
    </div>

    <!-- Edit plan: what the plan has of its own. The rest is Your training, from its line. -->
    <div v-else class="col setup" data-plan-setup>
      <Segmented v-model="answers.goal" size="compact" class="full" label="Goal" :options="GOALS" />
      <div class="dpick" role="group" aria-label="Days you train" data-plan-days>
        <button
          v-for="(day, index) in WEEKDAYS" :key="day" type="button" class="dbtn" :aria-pressed="answers.weekdays.includes(index)"
          :aria-label="day" @click="toggleDay(index)"
        ><span class="t-label">{{ day[0] }}</span></button>
      </div>

      <div class="col g4">
        <button type="button" class="row using" :aria-label="`Your training: ${usingLine(training)}. Change`" data-plan-using @click="openTraining">
          <Icon name="user" :size="16" class="c2" />
          <span class="t-label c2 grow">{{ usingLine(training) }}</span>
          <Icon name="edit" :size="14" class="c3" />
        </button>
        <p v-if="trainingChanged" class="t-capn c2 m0" data-plan-training-changed>Your training has changed since this plan was made. Saving brings the plan up to date.</p>
      </div>

      <SwitchRow title="Ease in" caption="The first 2 weeks stop further from failure, with smaller load steps." :on="easeIn" data-plan-ease-in @toggle="answers.easeIn = !easeIn" />

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

      <div class="col g4">
        <span class="t-capn c2">If a doctor has told you about a heart condition, or you get chest pain, faintness or dizziness when active, check with them before you start.</span>
        <span class="t-capn c3">Training suggestions, not medical advice.</span>
      </div>

      <div class="col g8 endwrap">
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
      <div v-if="reviewing" class="col g8">
        <button type="button" class="btn primary block t-bodys" :disabled="!!missing || plan.saving || !trainingChanged || previewState !== 'ready'" data-plan-update-save @click="save">Update plan</button>
        <button type="button" class="btn secondary block t-bodys" data-plan-update-edit @click="reviewing = false">Edit plan</button>
      </div>
      <button v-else type="button" class="btn primary block t-bodys" :disabled="!!missing || plan.saving || (!editing && previewState !== 'ready')" data-plan-save @click="save">
        {{ editing ? "Save plan" : "Start this plan" }}
      </button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g4 { gap: var(--space-xs); }
.g8 { gap: var(--space-s); }
.g16 { gap: var(--space-m); }
/* Your training, in a line you can tap to change it. */
.using { width: 100%; min-height: var(--control-hit); gap: var(--space-s); padding: 0; background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.using .grow { min-width: 0; overflow-wrap: anywhere; }
/* At XL the icons stay beside the words; only the words wrap. */
.dt-xl .using { flex-wrap: nowrap; }
.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.setup { gap: var(--space-l); }
.wrap { flex-wrap: wrap; column-gap: var(--space-s); row-gap: 0; }
.splitbtn, .endbtn { align-self: flex-start; }
.confirm { gap: var(--space-s); }
.cbtns { gap: var(--space-s); }
.g2 { gap: var(--space-2xs); }
.list { list-style: none; margin: 0; padding: 0; }
/* Update plan: Now and New side by side, as Recalculate shows a new target. */
.compare { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-s) var(--space-m); align-items: baseline; }
.compare > * { overflow-wrap: anywhere; }
.diffs { display: flex; flex-direction: column; }
.diffs > li { padding-block: var(--space-s); }
.diffs > li + li { border-top: 1px solid var(--color-border); }
</style>
