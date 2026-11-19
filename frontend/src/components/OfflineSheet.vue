<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { offlineRows, updatedText } from "../lib/offline";
import { summarize } from "../lib/outbox";
import { connection } from "../state/connection";
import { outbox } from "../state/outbox";
import { closeSheet, ui } from "../ui";

/** "You're offline": what is waiting to send, how old Weight and Progress are, and what needs a connection. */
const open = computed(() => ui.sheet === "offline");
const rows = computed(() => offlineRows(summarize(outbox.ops), updatedText(connection.contactAt)));
</script>

<template>
  <BottomSheet :open="open" label="You're offline" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">You're offline</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body" data-offline-sheet>
      <p class="t-capn c2 m0">Gym Bro keeps working on this phone and catches up by itself when you're back online.</p>
      <ul class="col rows">
        <li v-for="row in rows" :key="row.title" class="orow">
          <Icon :name="row.icon" :size="18" class="c2 oic" />
          <span class="col grow">
            <span class="t-body">{{ row.title }}</span>
            <span class="t-capn c2">{{ row.detail }}</span>
          </span>
        </li>
      </ul>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; }
.body { gap: var(--space-s); }
.rows { list-style: none; margin: 0; padding: 0; }
.orow { min-height: 52px; display: flex; align-items: flex-start; gap: 14px; padding: var(--space-s) 0; }
.orow + .orow { border-top: 1px solid var(--color-border); }
.oic { flex: none; margin-top: 2px; }
</style>
