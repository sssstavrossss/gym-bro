<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { updatedText } from "../lib/offline";
import { connection } from "../state/connection";
import { openOffline } from "../ui";

/** "Offline · updated 14:32" under a page title. A tap explains what works offline. */
const updated = computed(() => updatedText(connection.contactAt));
</script>

<template>
  <button v-if="connection.offline" type="button" class="offline-line t-capn c2" data-offline-line @click="openOffline">
    <Icon name="cloud-off" :size="15" />
    <span><b class="lead">Offline</b><template v-if="updated"> · updated {{ updated }}</template></span>
  </button>
</template>

<style scoped>
/* 44px to tap, but it sits as close under the title as a line of text would. */
.offline-line {
  display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
  min-height: 44px; margin: -10px 0 -6px -8px; padding: 0 8px;
  background: none; border: 0; border-radius: var(--radius-m); font: inherit; color: var(--text-secondary); cursor: pointer;
}
.lead { color: var(--text-primary); font-weight: 600; }
</style>
