<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { FAN_PER_PAGE, fanAngle, type FanActionId } from "../lib/fan";
import { FAN_MAX_PAGES, addAction, defaultFan, dropSpot, fanAction, placeAction, sameFan, stepAction, unusedActions, type FanLayout, type FanRow, type FanSection } from "../lib/fanPages";
import { useRowDrag } from "../lib/rowDrag";
import { describe } from "../state/describe";
import { fanLayout, saveFanLayout } from "../state/fanPages";
import { closeFanPages, ui } from "../ui";

/**
 * Arranges the + fan: up to four pages of one to five actions, and the ones left off. One list with a
 * heading per page; drag a row by its grip or hold it to move it within a page, to another page, to a
 * new page, or off the fan. ↑/↓ on the grip step it through the same places. − takes an action off,
 * + puts it on the last page with room. Every change applies at once and is saved on the account.
 */
const open = computed(() => ui.sheet === "fan-pages" || (ui.fanPagesOver && ui.sheet !== null));
// The sheet under it closed or changed, so this goes with it.
watch(() => ui.sheet, () => { ui.fanPagesOver = false; });

const pages = computed(() => fanLayout.value);
const unused = computed(() => unusedActions(pages.value));
const lines = computed<FanRow[]>(() => [
  ...pages.value.flatMap((page, section): FanRow[] => [{ kind: "head", section }, ...page.map((id): FanRow => ({ kind: "row", id }))]),
  ...(pages.value.length < FAN_MAX_PAGES ? [{ kind: "head", section: "new" } as FanRow] : []),
  { kind: "head", section: "out" },
  ...unused.value.map((id): FanRow => ({ kind: "row", id })),
]);
const total = computed(() => pages.value.flat().length);
const changed = computed(() => !sameFan(pages.value, defaultFan()));

function lineKey(line: FanRow) {
  return line.kind === "row" ? line.id : `head-${line.section}`;
}
function onFan(id: FanActionId) {
  return pages.value.some((page) => page.includes(id));
}
function caption(id: FanActionId) {
  return id === "describe" && !describe.available ? "Not available right now" : "";
}
/** The page's buttons as dots on a small arc, spaced as the fan spaces them. */
function arcDots(count: number) {
  return Array.from({ length: count }, (_, at) => {
    const angle = (fanAngle(at, count) * Math.PI) / 180;
    return { x: 16 + 12 * Math.cos(angle), y: 15 - 12 * Math.sin(angle) };
  });
}

// What a screen reader hears after a move.
const said = ref("");
function where(next: FanLayout, id: FanActionId) {
  const page = next.findIndex((items) => items.includes(id));
  if (page < 0) return `${fanAction(id).label}, not in the fan`;
  return `${fanAction(id).label}, page ${page + 1}, ${next[page].indexOf(id) + 1} of ${next[page].length}`;
}
function apply(next: FanLayout | null, id: FanActionId) {
  if (!next || sameFan(next, pages.value)) return false;
  saveFanLayout(next);
  said.value = where(next, id);
  return true;
}

// Dragging: a place a row can't take (a full page, a fifth page, the fan's last action off) opens no gap.
const list = ref<HTMLElement | null>(null);
/** The page heading a drag is over that can't take the row, to say it's full. */
const blocked = ref<FanSection | null>(null);
function target(from: number, to: number) {
  const line = lines.value[from];
  if (line.kind !== "row") return null;
  const spot = dropSpot(lines.value, from, to);
  return { id: line.id, spot, next: placeAction(pages.value, line.id, spot) };
}
const { drag, settling, onGrip, onRowDown, onMove, onUp, onCancel, offset, wasHeld } = useRowDrag({
  list,
  selector: "[data-fan-line]",
  land(from, to) {
    const found = target(from, to);
    blocked.value = found && !found.next ? found.spot.section : null;
    return found?.next ? to : from;
  },
  drop(from, to) {
    const found = target(from, to);
    if (found) apply(found.next, found.id);
  },
});
watch(drag, (value) => { if (!value) blocked.value = null; });

async function onGripKey(event: KeyboardEvent, id: FanActionId) {
  const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (!step) return;
  event.preventDefault();
  if (!apply(stepAction(pages.value, id, step), id)) return;
  await nextTick();
  list.value?.querySelector<HTMLElement>(`[data-fan-row="${id}"] [data-grip]`)?.focus();
}
function take(id: FanActionId) {
  if (wasHeld()) return;
  apply(onFan(id) ? placeAction(pages.value, id, { section: "out", at: 0 }) : addAction(pages.value, id), id);
}
function reset() {
  saveFanLayout(defaultFan());
  said.value = "Default pages";
}
</script>

<template>
  <BottomSheet :open="open" label="+ button" @close="closeFanPages">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">+ button</h2>
        <button type="button" class="cbtn" aria-label="Close" @click="closeFanPages"><Icon name="x" :size="18" /></button>
      </div>
    </template>
    <div class="col body" data-fan-pages-sheet>
      <p class="t-capn c2 m0">Up to four pages of five. Drag an action to change its place or its page.</p>
      <div
        ref="list"
        class="col drag-list"
        :class="{ dragging: drag, settling }"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onCancel"
      >
        <template v-for="(line, index) in lines" :key="lineKey(line)">
          <div
            v-if="line.kind === 'head' && typeof line.section === 'number'"
            class="drag-line sect"
            :style="{ transform: offset(index) ? `translateY(${offset(index)}px)` : undefined }"
            data-fan-line
            :data-fan-page="line.section + 1"
          >
            <svg class="arc" width="32" height="18" viewBox="0 0 32 18" aria-hidden="true">
              <path d="M4 15 A12 12 0 0 1 28 15" />
              <circle v-for="(dot, at) in arcDots(pages[line.section].length)" :key="at" :cx="dot.x" :cy="dot.y" r="2.2" />
            </svg>
            <h3 class="t-label c2 grow m0">Page {{ line.section + 1 }}</h3>
            <span class="t-capn c3" :class="{ full: blocked === line.section }">{{ blocked === line.section ? "Full" : `${pages[line.section].length} of ${FAN_PER_PAGE}` }}</span>
          </div>
          <div
            v-else-if="line.kind === 'head' && line.section === 'new'"
            class="drag-line slot t-capn c3"
            :class="{ full: blocked === 'new' }"
            :style="{ transform: offset(index) ? `translateY(${offset(index)}px)` : undefined }"
            data-fan-line
            data-fan-new
          >{{ blocked === "new" ? "Four pages is the most" : "Drag here for a new page" }}</div>
          <div
            v-else-if="line.kind === 'head'"
            class="drag-line sect"
            :style="{ transform: offset(index) ? `translateY(${offset(index)}px)` : undefined }"
            data-fan-line
            data-fan-out
          >
            <h3 class="t-label c2 grow m0">Not in the fan</h3>
            <span v-if="blocked === 'out'" class="t-capn full">The fan needs one</span>
          </div>
          <div
            v-else
            class="drag-line drag-row"
            :class="{ lifted: drag?.from === index, off: !onFan(line.id) }"
            :style="{ transform: offset(index) ? `translateY(${offset(index)}px)` : undefined }"
            data-fan-line
            :data-fan-row="line.id"
            @pointerdown="onRowDown($event, index)"
            @contextmenu.prevent
          >
            <button
              type="button"
              class="grip"
              :aria-label="`Move ${fanAction(line.id).label}`"
              aria-keyshortcuts="ArrowUp ArrowDown"
              data-grip
              @pointerdown="onGrip($event, index)"
              @keydown="onGripKey($event, line.id)"
            >
              <Icon name="grip" :size="20" />
            </button>
            <span class="adisc" aria-hidden="true"><Icon :name="fanAction(line.id).icon" :size="16" :sw="2.2" /></span>
            <span class="col grow name">
              <span class="t-body">{{ fanAction(line.id).label }}</span>
              <span v-if="caption(line.id)" class="t-capn c3">{{ caption(line.id) }}</span>
            </span>
            <button
              v-if="onFan(line.id)"
              type="button"
              class="cbtn take"
              :aria-label="`Take ${fanAction(line.id).label} off the fan`"
              :disabled="total === 1"
              @click="take(line.id)"
            ><Icon name="minus" :size="16" :sw="2.2" /></button>
            <button
              v-else
              type="button"
              class="cbtn take"
              :aria-label="`Add ${fanAction(line.id).label} to the fan`"
              :disabled="!addAction(pages, line.id)"
              @click="take(line.id)"
            ><Icon name="plus" :size="16" :sw="2.2" /></button>
          </div>
        </template>
      </div>
      <div v-if="changed" class="row">
        <button type="button" class="btn sm secondary t-label" data-fan-reset @click="reset"><Icon name="undo" :size="14" /> Reset</button>
      </div>
      <p class="sr-only" aria-live="polite">{{ said }}</p>
    </div>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: var(--space-s); align-items: center; }
.m0 { margin: 0; }
.body { gap: var(--space-s); }
/* A page's heading: its buttons on a small arc, its name, and how many of five. */
.sect { display: flex; align-items: center; gap: var(--space-s); min-height: var(--control-hit); }
.sect .arc { flex: none; }
.arc path { fill: none; stroke: var(--color-border); stroke-width: 1; }
.arc circle { fill: var(--text-secondary); }
.full { color: var(--text-primary); }
/* Where a drop starts a new page. */
.slot {
  display: flex; align-items: center; justify-content: center; min-height: var(--control-hit);
  border: 1.5px dashed var(--color-border-strong); border-radius: var(--radius-m); margin-block: var(--space-xs);
}
/* The action's own button from the fan, small. */
.adisc {
  width: var(--control-chip); height: var(--control-chip); border-radius: 50%; flex: none; margin-right: var(--space-m);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--color-action); color: var(--color-on-action);
}
.drag-row.off .adisc { background: var(--color-surface-2); color: var(--text-secondary); }
.name { padding-block: var(--space-s); }
/* − and + keep a 44px hit inside the row (the sheet scrolls sideways to anything past it), with the
   30px face at its right end, on the sheet's text edge. */
.take { --s: var(--control-chip); justify-content: flex-end; padding-right: calc((var(--control-hit) - var(--control-chip)) / 2); }
.take::before { right: 0; }
</style>
