<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { failedNote } from "../lib/offline";
import { connection } from "../state/connection";
import type { LogEntry } from "../state/log";

/**
 * The quiet line above a sheet's buttons: why a refused entry didn't send, or, offline, that
 * Save keeps the change on the phone.
 */
const props = defineProps<{ entry?: LogEntry | null }>();
const failed = computed(() => props.entry?.queued === "failed");
const text = computed(() => {
  if (failed.value) return failedNote(props.entry?.queuedNote);
  return connection.offline ? "Offline. This saves on your phone and sends when you're back online." : "";
});
</script>

<template>
  <p v-if="text" class="t-capn c2 onote" :role="failed ? 'alert' : 'status'" data-offline-note>
    <Icon :name="failed ? 'alert' : 'cloud-off'" :size="14" class="oic" />
    <span>{{ text }}</span>
  </p>
</template>

<style scoped>
.onote { display: flex; align-items: flex-start; gap: 6px; margin: var(--space-xs) 0 var(--space-s); }
.oic { flex: none; margin-top: 2px; }
</style>
