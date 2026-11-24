<script setup lang="ts">
// One logged food, as Home, Log and Add food's "added" card show it: a select box, the time, the name with its
// amount and macros, and the kcal. Touch swipes it for Copy to… and Delete and holds it to start selecting;
// a pointer gets the same two as hover buttons. The list around it owns what selecting and tapping do.
import { ref } from "vue";
import Icon from "./Icon.vue";
import SelectMark from "./SelectMark.vue";
import SwipeRow from "./SwipeRow.vue";
import { int } from "../lib/format";
import { longPressMoved, longPressMs } from "../lib/selection";
import { vp } from "../lib/viewport";
import type { LogEntry } from "../state/log";
import { foodAmount } from "../state/units";

const props = defineProps<{ entry: LogEntry; selected: boolean; selecting: boolean; oneline?: boolean }>();
const emit = defineEmits<{ tap: [MouseEvent]; check: [MouseEvent]; copy: []; delete: []; hold: [] }>();

function amountOf(entry: LogEntry): string {
  if (entry.unit && entry.amount) return foodAmount(entry.amount, entry.unit);
  return "";
}
function macros(entry: { protein: number; fat: number; carbs: number }): string {
  return `P${int(entry.protein)} F${int(entry.fat)} C${int(entry.carbs)}`;
}

let timer = 0;
let sx = 0;
let sy = 0;
const suppress = ref(false);
function pdown(event: PointerEvent) {
  if (event.pointerType === "mouse" || props.selecting || vp.hover) return;
  sx = event.clientX;
  sy = event.clientY;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    suppress.value = true;
    emit("hold");
    navigator.vibrate?.(10);
  }, longPressMs);
}
function pmove(event: PointerEvent) {
  if (longPressMoved(event.clientX - sx, event.clientY - sy)) window.clearTimeout(timer);
}
function pup() {
  window.clearTimeout(timer);
}
function swallow(event: MouseEvent) {
  if (!suppress.value) return;
  suppress.value = false;
  event.preventDefault();
  event.stopPropagation();
}
function onMenu(event: Event) {
  if (!vp.hover) event.preventDefault();
}
</script>

<template>
  <SwipeRow
    :id="entry.id"
    :swipe="!vp.hover && !selecting"
    :copy-label="`Copy ${entry.name} to another day`"
    :delete-label="`Delete ${entry.name}`"
    @copy="emit('copy')"
    @delete="emit('delete')"
  >
    <div
      class="line"
      :class="{ sel: selected, oneline }"
      @pointerdown="pdown"
      @pointermove="pmove"
      @pointerup="pup"
      @pointercancel="pup"
      @click.capture="swallow"
      @contextmenu="onMenu"
    >
      <button
        type="button"
        class="mark"
        :class="{ on: selected }"
        :aria-pressed="selected"
        :aria-label="`${selected ? 'Deselect' : 'Select'} ${entry.name}`"
        :tabindex="selecting || vp.hover ? 0 : -1"
        @click.stop="emit('check', $event)"
      >
        <SelectMark :on="selected" />
      </button>
      <button type="button" class="frow" :title="entry.name" @click="emit('tap', $event)">
        <span class="time t-label num" :class="selected ? '' : 'c2'">{{ entry.time }}</span>
        <span class="col two">
          <span class="t-body name">{{ entry.name }}</span>
          <span class="t-capn c2 sub">
            {{ amountOf(entry) ? `${amountOf(entry)} · ` : "" }}<!--
            A refused add drops its macros so "couldn't send" fits on one line.
            --><span v-if="entry.queued === 'failed'" class="qmark" data-queued="failed"><Icon name="alert" :size="13" />couldn't send</span><!--
            --><template v-else>{{ macros(entry) }}<template v-if="entry.queued"> · <span class="qmark" data-queued="waiting"><Icon name="cloud-off" :size="13" />waiting</span></template></template>
          </span>
        </span>
        <!-- A refused entry counts for nothing until it is saved again, so no number. -->
        <span class="t-bodys kc" data-num>{{ entry.queued === "failed" ? "" : int(entry.kcal) }}</span>
      </button>
      <span v-if="vp.hover && !selecting" class="hacts row">
        <button v-if="entry.queued !== 'failed'" type="button" class="hbtn" :aria-label="`Copy ${entry.name} to another day`" title="Copy to…" @click.stop="emit('copy')">
          <Icon name="copy" :size="16" />
        </button>
        <button type="button" class="hbtn" :aria-label="`Delete ${entry.name}`" title="Delete" @click.stop="emit('delete')">
          <Icon name="trash" :size="16" />
        </button>
      </span>
    </div>
  </SwipeRow>
</template>

<style scoped>
.line {
  position: relative; display: flex; align-items: center; gap: var(--space-s);
  width: 100%; min-height: 52px; min-width: 0; max-width: 100%; box-sizing: border-box;
  border-radius: 0; overflow: hidden; -webkit-touch-callout: none; user-select: none;
}
.line.sel { background: color-mix(in srgb, var(--text-primary) 7%, transparent); }
.frow {
  min-height: 52px; flex: 1 1 0%; min-width: 0; width: auto; max-width: 100%; text-align: left;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--space-s); background: transparent; border-radius: var(--radius-m); padding: var(--space-xs) 0;
}
.time { width: auto; min-width: 2.5rem; font-variant-numeric: tabular-nums; }
.two { gap: 1px; min-width: 0; align-items: flex-start; }
.name, .sub {
  display: block; min-width: 0; max-width: 100%;
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
  text-overflow: clip;
}
/* Capped lists: one line per name and amount, so every row is the same height. */
.oneline .name, .oneline .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; word-break: normal; }
.oneline .two { max-width: 100%; }
.oneline .two > * { width: 100%; }
.frow .kc {
  width: auto; min-width: 2.5rem; max-width: none; overflow-wrap: normal;
  text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
}
/* "waiting" and "couldn't send" ride on the detail line, icon and word together. */
.qmark { display: inline-flex; align-items: center; gap: 3px; vertical-align: -2px; white-space: nowrap; }
.mark { position: relative; width: 44px; height: 44px; flex: none; }
.hacts { position: absolute; right: 0; top: 0; bottom: 0; gap: var(--space-xs); align-items: center; opacity: 0; pointer-events: none; }
.hbtn {
  position: relative; width: var(--control-hit); height: var(--control-hit);
  display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: transparent; isolation: isolate;
}
.hbtn::before {
  content: ""; position: absolute; z-index: -1; width: var(--control-s); height: var(--control-s);
  border-radius: var(--radius-m); background: var(--color-surface-2);
  box-shadow: var(--d-edge);
}
.hbtn > * { position: relative; }
.hbtn:hover, .hbtn:focus-visible { color: var(--text-primary); }
.hbtn:hover::before, .hbtn:focus-visible::before { background: var(--shade-off); }
/* On a grey box (Add food's card) the hover buttons step up one shade, as buttons do there. */
.well .hbtn::before { background: var(--btn-bg); }
@media (hover: hover) and (pointer: fine) {
  .line:hover .hacts, .line:focus-within .hacts { opacity: 1; pointer-events: auto; }
  .line:hover .kc, .line:focus-within .kc { opacity: 0; }
  .line:hover .mark { cursor: pointer; }
}
</style>
