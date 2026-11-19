<script setup lang="ts">
import Icon from "./Icon.vue";
import { describe } from "../state/describe";
import { openFood, openFoodWithScan } from "../ui";

// Home's way into Add food: one pill, three doors. Search, the barcode scanner, and Describe a meal
// (only when the server can describe). Each part is a full 44 pt target; the colour is drawn smaller.

defineProps<{
  date: string;
  /** "Add food", or "Add food to 21 Nov" for another day. */
  addName: string;
}>();
</script>

<template>
  <span class="apill" role="group" aria-label="Add food" data-add-pill>
    <button type="button" :aria-label="addName" @click="openFood('search', date)"><Icon name="plus" :size="18" :sw="2.6" /></button>
    <button type="button" aria-label="Scan a barcode" @click="openFoodWithScan(date)"><Icon name="scan" :size="18" /></button>
    <button v-if="describe.available" type="button" aria-label="Describe a meal" @click="openFood('describe', date)"><Icon name="sparkle" :size="18" /></button>
  </span>
</template>

<style scoped>
.apill { display: inline-flex; flex: none; margin-block: -5px; }
.apill button {
  position: relative; isolation: isolate;
  width: 48px; height: var(--control-hit, 44px);
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--color-on-action);
}
.apill button::before {
  content: ""; position: absolute; inset: 5px 0; z-index: -1;
  background: var(--color-action);
}
.apill button:first-child::before { border-radius: var(--radius-pill) 0 0 var(--radius-pill); }
.apill button:last-child::before { border-radius: 0 var(--radius-pill) var(--radius-pill) 0; }
.apill button + button::after {
  content: ""; position: absolute; left: 0; top: 5px; bottom: 5px; width: 1px;
  background: color-mix(in srgb, var(--color-on-action) 22%, transparent);
}
@media (hover: hover) {
  .apill button:hover::before { filter: brightness(1.06); }
}
.apill button:active::before { filter: brightness(.94); }
.apill button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; border-radius: var(--radius-m); }
</style>
