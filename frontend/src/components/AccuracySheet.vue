<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { accuracyCopy } from "../lib/weightDisplay";
import { profile } from "../state/profile";
import { weightUnit, wt } from "../state/units";
import { closeAccuracy, openWeight, ui } from "../ui";

const open = computed(() => ui.sheet === "accuracy");
const copy = computed(() => accuracyCopy(profile.weight, weightUnit()));
const trend = computed(() => (profile.weight?.trendKg != null ? wt(profile.weight.trendKg) : "—"));

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
          <span class="t-label c2">Trend {{ trend }} {{ weightUnit() }}</span>
        </div>
        <button type="button" class="cbtn" aria-label="Close" @click="closeAccuracy"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body">
      <p v-for="line in copy.lines" :key="line" class="t-body m0">{{ line }}</p>
      <p class="t-label c2 m0">Your targets still use the trend. The dot goes away once you have 2 weigh-ins within 7 days.</p>
      <div class="col btns">
        <button v-if="ui.accReturn !== 'weight'" type="button" class="btn primary block t-bodys" @click="weigh">Log weight</button>
        <button type="button" class="btn secondary block t-bodys" @click="closeAccuracy">Got it</button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: flex-start; }
.m0 { margin: 0; }
.ttl { gap: var(--space-m); align-items: center; }
.d { width: 10px; height: 10px; border-radius: 50%; background: var(--text-secondary); flex: none; }
.body { gap: var(--space-m); }
.btns { gap: var(--space-s); margin-top: var(--space-xs); }
</style>
