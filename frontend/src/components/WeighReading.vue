<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getExpectedWeight, type WeighInExpectation } from "../api";
import { expectedGap, expectedNote, expectedTitle } from "../lib/weighReading";
import { weightUnit } from "../state/units";
import Icon from "./Icon.vue";

/**
 * In Log weight: the weight this day is expected to show from the last weigh-in and the food
 * since, how far the typed (or saved) weight is from it, and whether this weigh-in will count for
 * less when the burn is measured. Hidden when there is nothing to go on or the server can't say.
 */
const props = defineProps<{ open: boolean; date: string; today: string; kg: number | null | undefined }>();

const expected = ref<WeighInExpectation | null>(null);
let asked = 0;

watch(() => [props.open, props.date] as const, async ([open, date]) => {
  const ask = ++asked;
  if (!open) return;
  expected.value = null;
  try {
    const answer = await getExpectedWeight(date);
    if (ask === asked) expected.value = answer;
  } catch {
    if (ask === asked) expected.value = null;
  }
}, { immediate: true });

const title = computed(() => (expected.value ? expectedTitle(expected.value, weightUnit()) : ""));
const gap = computed(() => (expected.value ? expectedGap(expected.value, props.kg, weightUnit()) : null));
const note = computed(() => (expected.value ? expectedNote(expected.value, props.today) : ""));
</script>

<template>
  <div v-if="expected" class="card outline wread" data-weigh-reading :data-sure="expected.sure ? 'yes' : 'no'">
    <span class="row top">
      <Icon name="scale" :size="16" class="c2 wi" />
      <span class="t-label grow">{{ title }}</span>
      <span v-if="gap" class="t-label num" data-weigh-gap>{{ gap }}</span>
    </span>
    <span class="t-capn c2">{{ note }}</span>
  </div>
</template>

<style scoped>
.wread { display: flex; flex-direction: column; gap: var(--space-xs); }
.top { gap: var(--space-s); align-items: baseline; }
.wi { flex: none; align-self: center; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
html.dt-xl .top { flex-wrap: wrap; }
</style>
