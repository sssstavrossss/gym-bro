<script setup lang="ts">
// S8: subtle low-accuracy marker next to the trend. Grey, never red; a real button with a 44 px target
// and a spoken label (decision 25: colour is never the only signal). Tap or click → the explaining sheet.
import { computed } from "vue";
import { accuracyReason } from "../lib/accuracy";
import { openAccuracy } from "../ui";
const props = withDefaults(defineProps<{ label?: boolean; interactive?: boolean }>(), { label: false, interactive: true });
const aria = computed(() => `Low accuracy: ${accuracyReason.value.short}. What does this mean?`);
</script>

<template>
  <button v-if="interactive" type="button" class="accdot" :aria-label="aria" @click.stop="openAccuracy()">
    <i class="d" aria-hidden="true" /><span v-if="props.label" class="t-capn c2 lbl" aria-hidden="true">low accuracy</span>
  </button>
  <span v-else class="accdot static"><i class="d" aria-hidden="true" /><span class="sr-only">, low accuracy</span><span v-if="props.label" class="t-capn c2 lbl" aria-hidden="true">low accuracy</span></span>
</template>

<style scoped>
.accdot { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 24px; min-height: 24px; padding: 0 8px; margin: -4px -8px; border-radius: 10px; color: var(--text-secondary); pointer-events: auto; vertical-align: middle; }
.accdot:not(.static)::after { content: ""; position: absolute; inset: -10px; } /* ≥ 44 px target */
.d { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; box-shadow: 0 0 0 2px rgba(179, 179, 186, .18); }
.lbl { white-space: nowrap; }
.can-hover .accdot:not(.static):hover { color: var(--text-primary); }
.accdot:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.accdot.static { min-width: 0; min-height: 0; padding: 0; margin: 0; }
</style>
