<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import { closeSheet, toast, ui } from "../ui";
import { profile, saveWeighIn, weightCaption } from "../state/profile";
import { todayIso } from "../lib/dates";
import { parseDecimal } from "../lib/numbers";

const kgText = ref("");
const dateText = ref(todayIso());
const localError = ref("");
const open = computed(() => ui.sheet === "weight");
const caption = computed(() => weightCaption(profile.weight));

watch(open, (isOpen) => {
  if (!isOpen) return;
  dateText.value = todayIso();
  kgText.value = profile.weight?.latestKg != null ? profile.weight.latestKg.toFixed(1) : "";
  localError.value = "";
});

async function save() {
  const kg = parseDecimal(kgText.value);
  if (kg == null) {
    localError.value = "Enter a weight.";
    return;
  }
  const result = await saveWeighIn(dateText.value, kg);
  if (!result) {
    localError.value = profile.error || "Could not save that weigh-in.";
    return;
  }
  toast(result.notice ?? "Weigh-in saved.");
  closeSheet();
}
</script>

<template>
  <BottomSheet :open="open" label="Log weight" @close="closeSheet">
    <template #header>
      <h2 class="t-head">Log weight</h2>
      <p class="t-body c2">{{ caption.label }} {{ caption.value }}<template v-if="caption.note"> · {{ caption.note }}</template></p>
    </template>
    <label class="field">
      <span class="t-label c2">Date</span>
      <input v-model="dateText" type="date" />
    </label>
    <label class="field">
      <span class="t-label c2">Weight, kg</span>
      <input v-model="kgText" type="text" inputmode="decimal" autocomplete="off" aria-label="Weight in kilograms" />
    </label>
    <p class="t-label c2">One weigh-in a day. Saving again replaces that day. Use a comma or a point.</p>
    <p v-if="localError" class="alert" role="alert">{{ localError }}</p>
    <button type="button" class="primary-btn t-bodys" @click="save">Save weigh-in</button>
  </BottomSheet>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
input { min-height: 44px; border-radius: 12px; border: 1px solid var(--color-border); background: var(--color-surface-2); padding: 0 12px; }
</style>
