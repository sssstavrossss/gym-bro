<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import PlanWeek from "./PlanWeek.vue";
import { previewPlan } from "../api";
import { defaultAnswers, kindDays, kindGoal, PLAN_KINDS, splitFor, splitLabel, type PlanAnswers, type PlanKind, type PlanPreview } from "../lib/plan";
import { usingLine, withTraining } from "../lib/training";
import { planDraft } from "../state/plan";
import { training } from "../state/training";
import { closeSheet, openPlan, openTraining, ui } from "../ui";

// Explore → Plans: the kinds of plan, and a week of each made from your days and Your training.
const open = computed(() => ui.sheet === "plans");
const kind = ref<PlanKind | null>(null);
const preview = ref<PlanPreview | null>(null);
const previewState = ref<"loading" | "ready" | "failed">("loading");

watch(open, (shown) => {
  if (shown) kind.value = null;
});

/** The plan a kind makes: your days when they fit it, its goal, and Your training. */
const answers = computed<PlanAnswers | null>(() => {
  if (!kind.value) return null;
  const goal = kindGoal(kind.value, planDraft.goal);
  const weekdays = kindDays(kind.value, planDraft.weekdays);
  const split = kind.value.split === splitFor(weekdays.length, goal) ? null : kind.value.split;
  return { ...withTraining(defaultAnswers(), training.value), goal, weekdays, split };
});

let seq = 0;
watch(answers, async (next) => {
  const at = ++seq;
  preview.value = null;
  if (!next) return;
  previewState.value = "loading";
  try {
    const made = await previewPlan(next);
    if (at !== seq) return;
    preview.value = made;
    previewState.value = "ready";
  } catch {
    if (at === seq) previewState.value = "failed";
  }
}, { deep: true });

function use() {
  if (!answers.value) return;
  planDraft.goal = answers.value.goal;
  planDraft.weekdays = [...answers.value.weekdays];
  openPlan(answers.value.split);
}
</script>

<template>
  <BottomSheet :open="open" :label="kind ? splitLabel(kind.split) : 'Plans'" full @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <button v-if="kind" type="button" class="cbtn" aria-label="Back to Plans" @click="kind = null"><Icon name="left" :size="18" /></button>
        <h2 class="t-head m0 grow">{{ kind ? splitLabel(kind.split) : "Plans" }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>

    <div v-if="!kind" class="col body" data-plans>
      <p class="t-label c2 m0">Your days pick the split. Tap one to see a week of it.</p>
      <ul class="list col">
        <li v-for="item in PLAN_KINDS" :key="item.split">
          <button type="button" class="row krow" :data-plan-kind="item.split" @click="kind = item">
            <span class="col grow g2">
              <span class="row khead"><span class="t-bodys">{{ splitLabel(item.split) }}</span><span class="tag t-capn">{{ item.days }}</span></span>
              <span class="t-capn c2">{{ item.line }}</span>
              <span class="t-capn c3">{{ item.goals }}</span>
            </span>
            <Icon name="right" :size="16" class="c3" />
          </button>
        </li>
      </ul>
    </div>

    <div v-else class="col body" :data-plan-kind-week="kind.split">
      <p class="t-label c2 m0">{{ kind.line }}.</p>
      <div aria-live="polite">
        <PlanWeek v-if="preview && previewState === 'ready' && answers" :preview="preview" :weekdays="answers.weekdays" :minutes="answers.minutes" />
        <div v-else class="well col g4">
          <template v-if="previewState === 'failed'">
            <span class="t-bodys">Couldn't show the plan</span>
            <span class="t-capn c2">Seeing a plan needs a connection.</span>
          </template>
          <template v-else>
            <span class="t-bodys">Making a week of it…</span>
            <span class="t-capn c2">&nbsp;</span>
          </template>
        </div>
      </div>
      <button type="button" class="row using" :aria-label="`Your training: ${usingLine(training)}. Change`" data-plan-using @click="openTraining">
        <Icon name="user" :size="16" class="c2" />
        <span class="t-label c2 grow">{{ usingLine(training) }}</span>
        <Icon name="edit" :size="14" class="c3" />
      </button>
    </div>

    <template v-if="kind" #footer>
      <button type="button" class="btn primary block t-bodys" :disabled="previewState !== 'ready'" data-plan-kind-use @click="use">Use this plan</button>
    </template>
  </BottomSheet>
</template>

<style scoped>
.m0 { margin: 0; }
.g2 { gap: 2px; }
.g4 { gap: var(--space-xs); }
.hdr { gap: var(--space-s); flex-wrap: nowrap; }
.body { gap: var(--space-l); }
.list { list-style: none; margin: 0; padding: 0; }
.list > li + li { border-top: 1px solid var(--color-border); }
.krow { width: 100%; min-height: 56px; gap: var(--space-m); padding: var(--space-s) 0; background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.krow .grow { min-width: 0; }
.row.khead { gap: var(--space-xs) var(--space-s); flex-wrap: wrap; }
/* Your training, in a line you can tap to change it; at XL the icons stay beside the words. */
.using { width: 100%; min-height: var(--control-hit); gap: var(--space-s); padding: 0; background: none; border: 0; color: inherit; text-align: left; flex-wrap: nowrap; }
.using .grow { min-width: 0; overflow-wrap: anywhere; }
.dt-xl .using, .dt-xl .krow { flex-wrap: nowrap; }
</style>
