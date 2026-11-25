<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import SwitchRow from "./SwitchRow.vue";
import { isDefaultOrder, orderPages, pageIds, pageRows } from "../lib/cardPages";
import { dropIndex, rowShift, stepIndex, type RowBox } from "../lib/reorder";
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
  if (held) return;
  setPageShown(card.value, ids.value, id, !shown(id));
}

// Dragging
const list = ref<HTMLElement | null>(null);
const drag = ref<{ from: number; to: number; dy: number; height: number } | null>(null);
/** Just dropped: the rows take their new places without sliding back first. */
const settling = ref(false);
let boxes: RowBox[] = [];
let startY = 0;
let pointerId = -1;
let held = false;
let pressTimer = 0;
let press: { x: number; y: number; index: number; id: number } | null = null;

function measure() {
  boxes = [...(list.value?.querySelectorAll<HTMLElement>("[data-page-row]") ?? [])].map((row) => ({ top: row.offsetTop, height: row.offsetHeight }));
}
function begin(index: number, y: number, id: number) {
  measure();
  startY = y;
  pointerId = id;
  drag.value = { from: index, to: index, dy: 0, height: boxes[index]?.height ?? 0 };
  list.value?.setPointerCapture?.(id);
}
function onGrip(event: PointerEvent, index: number) {
  if (event.button !== 0 || drag.value) return;
  event.preventDefault();
  begin(index, event.clientY, event.pointerId);
}
/** Press and hold a row to pick it up; moving first is a scroll, so it lets go. */
function onRowDown(event: PointerEvent, index: number) {
  if (event.button !== 0 || drag.value || (event.target as HTMLElement).closest("[data-page-grip]")) return;
  press = { x: event.clientX, y: event.clientY, index, id: event.pointerId };
  window.clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    if (!press) return;
    held = true;
    begin(press.index, press.y, press.id);
    navigator.vibrate?.(10);
  }, 400);
}
function onMove(event: PointerEvent) {
  if (press && !drag.value && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
    window.clearTimeout(pressTimer);
    press = null;
  }
  const current = drag.value;
  if (!current || event.pointerId !== pointerId) return;
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  const own = boxes[current.from];
  if (!first || !last || !own) return;
  // Kept within the list, so the row can't be dragged off the sheet.
  const dy = Math.max(first.top - own.top, Math.min(last.top + last.height - own.top - own.height, event.clientY - startY));
  drag.value = { ...current, dy, to: dropIndex(boxes, current.from, dy) };
}
async function onUp(event: PointerEvent) {
  window.clearTimeout(pressTimer);
  press = null;
  const current = drag.value;
  if (!current || event.pointerId !== pointerId) return;
  drag.value = null;
  pointerId = -1;
  // The click that ends a held press lands on the switch: skip it, then allow taps again.
  window.setTimeout(() => { held = false; }, 0);
  if (current.to === current.from) return;
  settling.value = true;
  setPagePlace(card.value, ids.value, rows.value[current.from].id, current.to);
  announce(rows.value[current.to]?.title ?? "", current.to);
  await nextTick();
  requestAnimationFrame(() => { settling.value = false; });
}
function onCancel() {
  window.clearTimeout(pressTimer);
  press = null;
  drag.value = null;
  pointerId = -1;
  held = false;
}
function offset(index: number) {
  const current = drag.value;
  if (!current) return 0;
  return index === current.from ? current.dy : rowShift(index, current.from, current.to, current.height);
}
/** Stops the sheet scrolling while a held row is dragged on a touch screen. */
function blockScroll(event: TouchEvent) {
  if (drag.value) event.preventDefault();
}
watch(list, (el, old) => {
  old?.removeEventListener("touchmove", blockScroll);
  el?.addEventListener("touchmove", blockScroll, { passive: false });
});
onBeforeUnmount(() => {
  list.value?.removeEventListener("touchmove", blockScroll);
  window.clearTimeout(pressTimer);
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
        class="col list"
        :class="{ dragging: drag, settling }"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onCancel"
      >
        <div
          v-for="(row, index) in rows"
          :key="row.id"
          class="prow"
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
.list { position: relative; }
.prow { position: relative; display: flex; align-items: center; background: var(--color-surface); transition: transform .18s cubic-bezier(.2, .8, .2, 1); -webkit-touch-callout: none; user-select: none; }
.prow + .prow { border-top: 1px solid var(--color-border); }
.prow .grow { flex: 1 1 auto; min-width: 0; }
/* A 44px handle whose dots line up with the sheet's text edge. */
.grip { display: inline-grid; place-items: center; width: var(--control-hit); height: var(--control-hit); margin-left: calc((20px - var(--control-hit)) / 2); flex: none; background: none; border: 0; padding: 0; color: var(--text-tertiary); cursor: grab; touch-action: none; border-radius: var(--radius-m); }
.grip:focus-visible { outline: 2px solid var(--color-action); outline-offset: -2px; }
/* Off pages keep their place, a step dimmer, so the swipe order reads at a glance. */
.prow.off :deep(.col) { opacity: .55; }
.dragging .prow { cursor: grabbing; }
.prow.lifted { z-index: 2; transition: none; background: var(--color-surface-2); border-radius: var(--radius-m); box-shadow: var(--d-float); border-top-color: transparent; }
.prow.lifted + .prow { border-top-color: transparent; }
.settling .prow { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .prow { transition: none; }
}
</style>
