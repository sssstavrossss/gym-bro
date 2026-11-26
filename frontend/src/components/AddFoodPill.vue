<script setup lang="ts">
import Icon from "./Icon.vue";
import { describe } from "../state/describe";
import { openFood, openFoodWithScan } from "../ui";

// Home's way into Add food: one pill, three doors. Search, the barcode scanner, and Describe a meal
// (only when the server can describe). Each part is a full 44 pt target; the colour is drawn at the
// height of the app's small buttons (.btn.sm), with the same icon size, so it sits like "Log weight" or "Done".

defineProps<{
  date: string;
  /** "Add food", or "Add food to 21 Nov" for another day. */
  addName: string;
}>();
</script>

<template>
  <span class="apill" role="group" aria-label="Add food" data-add-pill>
    <button type="button" :aria-label="addName" @click="openFood('search', date)"><Icon name="plus" :size="16" :sw="2.6" /></button>
    <button type="button" aria-label="Scan a barcode" @click="openFoodWithScan(date)"><Icon name="scan" :size="16" /></button>
    <button v-if="describe.available" type="button" aria-label="Describe a meal" @click="openFood('describe', date)"><Icon name="sparkle" :size="16" /></button>
  </span>
</template>
