<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import FreshStart from "./FreshStart.vue";
import GoalReached from "./GoalReached.vue";
import RecalcPrompt from "./RecalcPrompt.vue";
import WeighNudge from "./WeighNudge.vue";
import { nextFront, stackPlaces, stackThrow } from "../lib/promptStack";

/**
 * Home's suggestions as one stack, like the toasts but without a timer: one card in front and the
 * edge of the next behind it. Swipe the front card sideways to send it to the back. ✕ on a card
 * dismisses it as before, and the next one comes forward. Tabbing or a screen reader moving
 * into a card behind brings that card to the front, so every card can be reached without swiping.
 */
const props = defineProps<{ fresh: boolean; goal: boolean }>();

/** Front to back. Goal reached is a one-off question, so it goes before the weekly reminders. */
const ORDER = ["fresh", "goal", "recalc", "weigh"];
type Place = "front" | "back" | "rest" | "off";

/** Recalculate and Weigh in decide for themselves whether they show, and say so. */
const reported = reactive({ recalc: false, weigh: false });
const shown = computed(() => {
  const keys = new Set<string>();
  if (props.fresh) keys.add("fresh");
  else {
    if (reported.recalc) keys.add("recalc");
    if (reported.weigh) keys.add("weigh");
  }
  if (props.goal) keys.add("goal");
  return keys;
});
const chosen = ref<string | null>(null);
const places = computed(() => stackPlaces(ORDER, shown.value, chosen.value));
const deep = computed(() => places.value.back != null);

function place(key: string): Place {
  const p = places.value;
  if (p.front === key) return "front";
  if (p.back === key) return "back";
  return p.rest.includes(key) ? "rest" : "off";
}

function bringForward(key: string) {
  if (place(key) === "back" || place(key) === "rest") chosen.value = key;
}

// Dragging the front card sideways. Up and down is left to the page, which scrolls.
const dragX = ref(0);
const dragging = ref(false);
const thrown = ref<{ key: string; side: -1 | 1 } | null>(null);
let start: { x: number; y: number; t: number; id: number } | null = null;

function down(event: PointerEvent, key: string) {
  if (place(key) !== "front" || !deep.value || thrown.value) return;
  if (event.button !== 0 || (event.target as Element).closest("button, a, input")) return;
  start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
}

function move(event: PointerEvent) {
  if (!start || event.pointerId !== start.id) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (!dragging.value) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    dragging.value = true;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }
  dragX.value = dx;
}

function up(event: PointerEvent, key: string) {
  if (!start || event.pointerId !== start.id) return;
  const side = dragging.value ? stackThrow(event.clientX - start.x, event.clientY - start.y, event.timeStamp - start.t) : 0;
  start = null;
  dragging.value = false;
  dragX.value = 0;
  if (side === 0) return;
  thrown.value = { key, side };
  window.setTimeout(() => {
    chosen.value = nextFront(ORDER, shown.value, key);
    thrown.value = null;
  }, 180);
}

function cancel() {
  start = null;
  dragging.value = false;
  dragX.value = 0;
}

function slotStyle(key: string) {
  if (thrown.value?.key === key) return { transform: `translateX(${thrown.value.side * 110}%)`, opacity: "0" };
  if (dragging.value && place(key) === "front") return { transform: `translateX(${dragX.value}px) rotate(${dragX.value / 40}deg)` };
  return undefined;
}
</script>

<template>
  <!-- Always mounted: Recalculate and Weigh in have to be, to find out whether they show. -->
  <div class="pstack" :class="{ deep, empty: !shown.size }" role="group" aria-label="Suggestions" data-prompt-stack>
    <div
      v-for="key in ORDER"
      :key="key"
      class="slot"
      :class="[place(key), { dragging: dragging && place(key) === 'front', grab: deep && place(key) === 'front' }]"
      :style="slotStyle(key)"
      :data-stack-card="key"
      :data-place="place(key)"
      @focusin="bringForward(key)"
      @pointerdown="down($event, key)"
      @pointermove="move"
      @pointerup="up($event, key)"
      @pointercancel="cancel"
    >
      <FreshStart v-if="key === 'fresh' && fresh" />
      <RecalcPrompt v-else-if="key === 'recalc' && !fresh" @shown="reported.recalc = $event" />
      <WeighNudge v-else-if="key === 'weigh' && !fresh" @shown="reported.weigh = $event" />
      <GoalReached v-else-if="key === 'goal' && goal" />
    </div>
  </div>
</template>

<style scoped>
.pstack { position: relative; display: grid; }
/* Room for the edge of the card behind. */
.pstack.deep { margin-bottom: var(--space-s); }
.slot { grid-area: 1 / 1; min-width: 0; transform-origin: 50% 100%; transition: transform .26s cubic-bezier(.2, .8, .2, 1), opacity .26s, filter .26s; }
.slot.off { display: none; }
.slot.front { position: relative; z-index: 2; }
.slot.grab { touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.slot.dragging { transition: none; }
/* The card behind matches the front one's height, sits a little lower, narrower and darker, and only its bottom edge shows. */
.slot.back, .slot.rest { position: absolute; inset: 0; pointer-events: none; }
.slot.back { z-index: 1; transform: translateY(var(--space-s)) scale(.94); filter: brightness(.8); }
.slot.rest { z-index: 0; opacity: 0; transform: translateY(var(--space-s)) scale(.88); }
.slot > :deep(.card) { height: 100%; box-sizing: border-box; }
/* Outline cards have no fill: in a stack the front one covers the one behind. */
.pstack.deep .slot > :deep(.card.outline) { background: var(--color-bg); }
.slot.back > :deep(.card) { overflow: hidden; }
.slot.back > :deep(.card) > *, .slot.rest > :deep(.card) > * { opacity: 0; }
.pstack.empty { display: none; }
@media (prefers-reduced-motion: reduce) {
  .slot { transition: none; }
}
</style>
