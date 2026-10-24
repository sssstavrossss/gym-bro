<script setup lang="ts">
import { computed } from "vue";
import { accuracyCopy } from "../lib/weightDisplay";
import { profile } from "../state/profile";
import { openAccuracy } from "../ui";

const props = withDefaults(defineProps<{ label?: boolean; interactive?: boolean; from?: "weight" }>(), {
  label: false,
  interactive: true,
});
const aria = computed(() => {
  const reason = accuracyCopy(profile.weight).short || "fewer than 2 weigh-ins in 7 days";
  return `Low accuracy: ${reason}. What does this mean?`;
});
</script>

<template>
  <button v-if="interactive" type="button" class="accdot" :aria-label="aria" @click.stop="openAccuracy(props.from)">
    <i class="d" aria-hidden="true" />
    <span v-if="label" class="t-capn c2 lbl" aria-hidden="true">low accuracy</span>
  </button>
  <span v-else class="accdot static">
    <i class="d" aria-hidden="true" />
    <span class="sr-only">, low accuracy</span>
    <span v-if="label" class="t-capn c2 lbl" aria-hidden="true">low accuracy</span>
  </span>
</template>

<style scoped>
.accdot {
  position: relative; z-index: 2; display: inline-flex; align-items: center; justify-content: center;
  gap: 5px; min-width: 44px; min-height: 44px; padding: 0 8px; border-radius: 10px;
  color: var(--text-secondary); vertical-align: middle;
}
.d { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; box-shadow: 0 0 0 2px rgba(179, 179, 186, .18); }
.lbl { white-space: nowrap; }
.accdot.static { min-width: 0; min-height: 0; padding: 0; }
.can-hover .accdot:not(.static):hover { color: var(--text-primary); }
</style>
