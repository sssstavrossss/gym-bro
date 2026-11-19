<script setup lang="ts">
import { computed, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import SwitchRow from "./SwitchRow.vue";
import { pageIds, pageRows } from "../lib/cardPages";
import { cardPages, setPageShown } from "../state/cardPages";
import { closeCardPages, ui } from "../ui";

/**
 * Picks which pages a swipe card shows, on Home and on every macros card. Each switch applies at
 * once; the first page stays. From a cog inside another sheet it opens over that sheet.
 */
const open = computed(() => ui.sheet === "card-pages" || (ui.cardPagesOver && ui.sheet !== null));
// The sheet under it closed or changed (a save, a toast's Undo), so this goes with it.
watch(() => ui.sheet, () => { ui.cardPagesOver = false; });
const card = computed(() => ui.cardPages);
const title = computed(() => (card.value === "progress" ? "Progress pages" : "Macros card pages"));
const hint = computed(() => (card.value === "progress"
  ? "Pick the charts you can swipe to on Home."
  : "Pick the panels you can swipe to on every macros card: Home, adding a food and recipes."));
const rows = computed(() => pageRows(card.value));

function shown(id: string) {
  return !cardPages[card.value].includes(id);
}
function flip(id: string) {
  setPageShown(card.value, pageIds(card.value), id, !shown(id));
}
</script>

<template>
  <BottomSheet :open="open" :label="title" @close="closeCardPages">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">{{ title }}</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeCardPages"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body" :data-card-pages-sheet="card">
      <p class="t-capn c2 m0">{{ hint }}</p>
      <div class="col">
        <SwitchRow
          v-for="(row, index) in rows"
          :key="row.id"
          :title="row.title"
          :caption="row.caption"
          :on="shown(row.id)"
          :locked="index === 0"
          :data-page-switch="row.id"
          @toggle="flip(row.id)"
        />
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; }
.body { gap: var(--space-s); }
</style>
