<script setup lang="ts">
// S8: what the grey dot means. Opened from the dot on Today, Weight, the sidebar.
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import { kg } from "../lib/format";
import { accuracyReason } from "../lib/accuracy";
import { trendWeight } from "../store";
import { closeAccuracy, openWeight, ui } from "../ui";
const open = computed(() => ui.sheet === "accuracy");
function weigh() { ui.accReturn = null; openWeight(); }
</script>

<template>
  <BottomSheet :open="open" label="Trend accuracy" compact @close="closeAccuracy">
    <template #header>
      <div class="row hdr">
        <div class="col grow"><h2 class="t-head m0 row ttl"><i class="d" aria-hidden="true" />Low accuracy</h2>
          <span class="t-label c2">Trend {{ kg(trendWeight) }} kg</span></div>
        <CircleBtn icon="x" label="Close" @click="closeAccuracy" />
      </div>
    </template>
    <div class="col body">
      <p v-for="l in accuracyReason.lines" :key="l" class="t-body m0">{{ l }}</p>
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
.body { gap: 12px; padding-bottom: 4px; flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 -16px; padding: 0 16px 4px; }
.body > * { flex-shrink: 0; }
.btns { gap: 4px; margin-top: 4px; }
.ghost { min-height: 48px; border-radius: 24px; color: var(--text-primary); background: var(--color-surface-2); }
.can-hover .ghost:hover { background: #303036; }
</style>
