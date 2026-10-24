<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import { kg } from "../lib/format";
import { accuracyCopy } from "../lib/weightDisplay";
import { profile } from "../state/profile";
import { closeAccuracy, openWeight, ui } from "../ui";

const open = computed(() => ui.sheet === "accuracy");
const copy = computed(() => accuracyCopy(profile.weight));
const trend = computed(() => (profile.weight?.trendKg != null ? kg(profile.weight.trendKg, 2) : "—"));

function weigh() {
  ui.accReturn = null;
  ui.keepWeightDraft = false;
  openWeight();
}
</script>

<template>
  <BottomSheet :open="open" label="Trend accuracy" @close="closeAccuracy">
    <template #header>
      <div class="row hdr">
        <div class="col grow">
          <h2 class="t-head m0 row ttl"><i class="d" aria-hidden="true" />Low accuracy</h2>
          <span class="t-label c2">Trend {{ trend }} kg</span>
        </div>
        <button type="button" class="cbtn" aria-label="Close" @click="closeAccuracy">×</button>
      </div>
    </template>
    <div class="col body">
      <p v-for="line in copy.lines" :key="line" class="t-body m0">{{ line }}</p>
      <p class="t-label c2 m0">Your targets still use the trend. The dot goes away once you have 2 weigh-ins within 7 days.</p>
      <div class="col btns">
        <button v-if="ui.accReturn !== 'weight'" type="button" class="primary-btn t-bodys" @click="weigh">Log weight</button>
        <button type="button" class="ghost t-bodys" @click="closeAccuracy">Got it</button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; align-items: flex-start; }
.m0 { margin: 0; }
.ttl { gap: 10px; align-items: center; }
.d { width: 10px; height: 10px; border-radius: 50%; background: var(--text-secondary); flex: none; }
.body { gap: 12px; }
.btns { gap: 8px; margin-top: 4px; }
.ghost { min-height: 48px; border-radius: 24px; color: var(--text-primary); background: var(--color-surface-2); }
.cbtn { width: 44px; height: 44px; font-size: 1.25rem; }
</style>
