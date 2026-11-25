<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import SwitchRow from "./SwitchRow.vue";
import { isDefaultOrder, orderPages, pageIds, pageRows } from "../lib/cardPages";
import { stepIndex } from "../lib/reorder";
import { useRowDrag } from "../lib/rowDrag";
import { cardPages, pageOrder, resetPageOrder, setPagePlace, setPageShown } from "../state/cardPages";
import { closeCardPages, ui } from "../ui";

/**
 * Picks which pages a swipe card shows, and their order, on Home and on every macros card. Each
 * switch and each move applies at once. The card's first default page (Macros, Weight) moves but
 * stays on. A page switched off keeps its place, so switching it back on puts it where it was.
 * Drag a row by its handle, or press and hold the row; the handle also moves with the arrow keys.
 * From a cog inside another sheet it opens over that sheet.
 */
const open = computed(() => ui.sheet === "card-pages" || (ui.cardPagesOver && ui.sheet !== null));
// The sheet under it closed or changed (a save, a toast's Undo), so this goes with it.
watch(() => ui.sheet, () => { ui.cardPagesOver = false; });
const card = computed(() => ui.cardPages);
const title = computed(() => (card.value === "progress" ? "Progress pages" : "Macros card pages"));
const hint = computed(() => (card.value === "progress"
  ? "Pick the charts you can swipe to on Home, and drag them into the order you swipe through."
  : "Pick the panels you can swipe to on every macros card, and drag them into order: Home, adding a food and recipes."));
const ids = computed(() => pageIds(card.value));
const rows = computed(() => {
  const byId = new Map(pageRows(card.value).map((row) => [row.id, row]));
  return orderPages(ids.value, pageOrder[card.value]).map((id) => byId.get(id)!);
});
const changed = computed(() => !isDefaultOrder(ids.value, pageOrder[card.value]));

function shown(id: string) {
  return !cardPages[card.value].includes(id);
}
function flip(id: string) {
  // The press that picked a row up isn't a tap on its switch.
  if (wasHeld()) return;
  setPageShown(card.value, ids.value, id, !shown(id));
}

// Dragging, by the handle or by holding the row.
const list = ref<HTMLElement | null>(null);
const { drag, settling, onGrip, onRowDown, onMove, onUp, onCancel, offset, wasHeld } = useRowDrag({
  list,
  selector: "[data-page-row]",
  drop(from, to) {
    setPagePlace(card.value, ids.value, rows.value[from].id, to);
    announce(rows.value[to]?.title ?? "", to);
  },
});

// Keyboard: ↑ and ↓ on a handle move its page one place.
const said = ref("");
function announce(name: string, index: number) {
  said.value = `${name}, ${index + 1} of ${rows.value.length}`;
}
async function onGripKey(event: KeyboardEvent, index: number) {
  const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!step) return;
  event.preventDefault();
  const to = stepIndex(index, step, rows.value.length);
  if (to === index) return;
  const id = rows.value[index].id;
  setPagePlace(card.value, ids.value, id, to);
  announce(rows.value[to]?.title ?? "", to);
  await nextTick();
  list.value?.querySelector<HTMLElement>(`[data-page-row="${id}"] [data-page-grip]`)?.focus();
}
function reset() {
  resetPageOrder(card.value);
  said.value = "Default order";
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
      <div
        ref="list"
        class="col drag-list"
        :class="{ dragging: drag, settling }"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onCancel"
      >
        <div
          v-for="(row, index) in rows"
          :key="row.id"
          class="drag-line drag-row"
          :class="{ off: !shown(row.id) && row.id !== ids[0], lifted: drag?.from === index }"
          :style="{ transform: offset(index) ? `translateY(${offset(index)}px)` : undefined }"
          :data-page-row="row.id"
          @pointerdown="onRowDown($event, index)"
          @contextmenu.prevent
        >
          <button
            type="button"
            class="grip"
            :aria-label="`Move ${row.title}, ${index + 1} of ${rows.length}`"
            aria-keyshortcuts="ArrowUp ArrowDown"
            data-grip
            data-page-grip
            @pointerdown="onGrip($event, index)"
            @keydown="onGripKey($event, index)"
          >
            <Icon name="grip" :size="20" />
          </button>
          <SwitchRow
            class="grow"
            :title="row.title"
            :caption="row.caption"
            :on="shown(row.id)"
            :locked="row.id === ids[0]"
            :data-page-switch="row.id"
            @toggle="flip(row.id)"
          />
        </div>
      </div>
      <div v-if="changed" class="row">
        <button type="button" class="btn sm secondary t-label" data-reset-order @click="reset"><Icon name="undo" :size="14" /> Reset order</button>
      </div>
      <p class="sr-only" aria-live="polite">{{ said }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; }
.body { gap: var(--space-s); }
/* Off pages keep their place, a step dimmer, so the swipe order reads at a glance. */
.drag-row.off :deep(.col) { opacity: .55; }
</style>
