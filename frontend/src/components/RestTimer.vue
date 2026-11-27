<script setup lang="ts">
import { clock } from "../lib/workout";
import { shiftRest } from "../state/workout";

// The rest after a ticked set, in the workout sheet's footer: −15, +15 and Skip, with a bar that runs down.
defineProps<{ left: number; share: number }>();
</script>

<template>
  <div class="col" data-rest>
    <div class="row rest">
      <span class="col grow g2">
        <span class="t-capn c2">{{ left ? "Rest" : "Rest over" }}</span>
        <span class="t-ns" role="timer" aria-live="off">{{ clock(left) }}</span>
      </span>
      <button type="button" class="btn sm secondary t-label" aria-label="15 seconds less" @click="shiftRest(-15)">−15</button>
      <button type="button" class="btn sm secondary t-label" aria-label="15 seconds more" @click="shiftRest(15)">+15</button>
      <button type="button" class="btn sm primary t-label" @click="shiftRest(null)">{{ left ? "Skip" : "OK" }}</button>
    </div>
    <span class="restbar" aria-hidden="true"><span class="restfill" :style="{ transform: `scaleX(${share})` }" /></span>
  </div>
</template>

<style scoped>
.g2 { gap: var(--space-2xs); min-width: 0; }
.rest { gap: var(--space-s); flex-wrap: nowrap; }
.restbar { display: block; height: 3px; border-radius: var(--radius-pill); background: var(--color-surface-2); margin-top: var(--space-s); overflow: hidden; }
.restfill { display: block; width: 100%; height: 100%; background: var(--color-action); transform-origin: left; transition: transform 1s linear; }
</style>
