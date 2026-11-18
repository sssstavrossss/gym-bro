<script setup lang="ts">
import { computed } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { pageIds, pageRows } from "../lib/cardPages";
import { cardPages, setPageShown } from "../state/cardPages";
import { closeSheet, ui } from "../ui";

/** Picks which pages a Home swipe card shows. Each switch applies at once; the first page stays. */
const open = computed(() => ui.sheet === "card-pages");
const card = computed(() => ui.cardPages);
const title = computed(() => (card.value === "progress" ? "Progress pages" : "Macros card pages"));
const hint = computed(() => (card.value === "progress" ? "Pick the charts you can swipe to on Home." : "Pick the panels you can swipe to on Home."));
const rows = computed(() => pageRows(card.value));

function shown(id: string) {
  return !cardPages[card.value].includes(id);
}
function flip(id: string) {
  setPageShown(card.value, pageIds(card.value), id, !shown(id));
}
</script>

<template>
  <BottomSheet :open="open" :label="title" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">{{ title }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeSheet"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body" :data-card-pages-sheet="card">
      <p class="t-capn c2 m0">{{ hint }}</p>
      <div class="col">
        <button
          v-for="(row, index) in rows"
          :key="row.id"
          type="button"
          class="srow"
          role="switch"
          :aria-checked="index === 0 || shown(row.id)"
          :disabled="index === 0"
          :data-page-switch="row.id"
          @click="flip(row.id)"
        >
          <span class="col grow">
            <span class="t-body">{{ row.title }}</span>
            <span class="t-capn c2">{{ row.caption }}</span>
          </span>
          <span class="switch" :class="{ on: index === 0 || shown(row.id), lock: index === 0 }" aria-hidden="true"><i /></span>
        </button>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; }
.body { gap: var(--space-s); }
.srow { min-height: 52px; width: 100%; display: flex; align-items: center; gap: var(--space-m); text-align: left; padding: 0; }
.srow + .srow { border-top: 1px solid var(--color-border); }
.srow:disabled { opacity: 1; cursor: default; }
.switch { position: relative; width: 46px; height: 28px; border-radius: var(--radius-l); background: var(--color-track); flex: none; transition: background .15s; }
.switch i { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: var(--radius-m); background: var(--text-tertiary); transition: transform .15s, background .15s; }
.switch.on { background: var(--color-action); }
.switch.on i { transform: translateX(18px); background: var(--color-on-action); }
.switch.lock { opacity: .45; }
</style>
