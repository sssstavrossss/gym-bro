<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDialogFocus } from "../lib/focusTrap";
import { shortTurn } from "../lib/carousel";
import { FAN_RADIUS, FAN_ROLL, fanAngle, fanDim, fanDrag, fanDragSpan, fanFade, fanRadius, fanScale, fanSettles, fanTurn, type FanActionId } from "../lib/fan";
import { fanShown } from "../lib/fanPages";
import { fanLayout } from "../state/fanPages";
import Icon from "./Icon.vue";
import { viewed } from "../state/log";
import { describe, loadDescribe } from "../state/describe";
import { newPast, readyQuickAdd } from "../state/workout";
import { closeSheet, openFanPages, openFood, openFoodWithScan, openNewFoodFrom, openRecipeCreate, openWeight, openWorkout, ui } from "../ui";

/**
 * The + fan: the buttons open on a half ring around the tab bar's +, one to five to a page, as arranged
 * in the + button sheet (the cog between the dots and the ×, or Settings). Drag sideways
 * and the page rolls along the ring with the finger while the next rolls in from the other side; let go
 * and it finishes or springs back. A dot or ←/→ rolls it the whole way. Pages wrap. The + under it turns into the close button.
 */
const open = computed(() => ui.sheet === "chooser");
const root = ref<HTMLElement | null>(null);
const restoreFocus = useDialogFocus(() => open.value, root);

/** Your pages (one to five buttons each, centred on the ring), without Describe when the server can't describe meals. */
const pages = computed(() => fanShown(fanLayout.value, describe.available));
const page = ref(0);
/** How far round the ring each page is rolled, in degrees: 0 for the page showing. */
const rolled = ref<number[]>([]);
/** False while the fan is closed up behind the +: the buttons spread out a frame after it opens. */
const spread = ref(false);
/** Placement without a transition, to set the next page on the far side before it rolls in. */
const instant = ref(false);
/** The buttons fan out one after another only as it opens. */
const staggered = ref(false);
const centre = ref({ x: 0, y: 0 });
/** A turn the finger is making: the page coming in, which way, and how far (0 to 1). */
const drag = ref<{ peer: number; dir: 1 | -1; t: number } | null>(null);
const radius = ref(FAN_RADIUS);

const route = useRoute();
function day(): string | undefined {
  const onDay = route.path.startsWith("/log") || route.path.startsWith("/today");
  return onDay && viewed.date ? viewed.date : undefined;
}

function run(id: FanActionId) {
  if (swiped) return;
  const date = day();
  if (id === "search") openFood("search", date);
  else if (id === "scan") openFoodWithScan(date);
  else if (id === "describe") openFood("describe", date);
  else if (id === "quick") openFood("quick", date);
  else if (id === "weight") openWeight();
  else if (id === "recipe") openRecipeCreate(null);
  else if (id === "food") openNewFoodFrom(date);
  else if (id === "recipes") openFood("search", date, "recipes");
  else if (id === "mine") openFood("search", date, "mine");
  else if (id === "workout") {
    // Opens the one going, else Add exercise with nothing started until the first exercise.
    readyQuickAdd();
    openWorkout();
  } else if (id === "log-workout") {
    newPast(date);
    openWorkout();
  } else openFood("search", date, "groups");
}

/** The ring is centred on the tab bar's +, wherever the layout puts it. */
function measure() {
  const box = root.value?.getBoundingClientRect();
  if (!box) return;
  const plus = document.querySelector<HTMLElement>(".tabbar .plus")?.getBoundingClientRect();
  const x = plus && plus.width > 0 ? plus.left + plus.width / 2 - box.left : box.width / 2;
  const y = plus && plus.height > 0 ? plus.top + plus.height / 2 - box.top : box.height - 72;
  centre.value = { x, y };
  radius.value = fanRadius(box.width, x);
}

let staggerTimer = 0;
watch(open, async (isOpen) => {
  spread.value = false;
  if (!isOpen) return;
  page.value = 0;
  drag.value = null;
  rolled.value = pages.value.map(() => 0);
  void loadDescribe();
  await nextTick();
  measure();
  staggered.value = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { spread.value = true; }));
  window.clearTimeout(staggerTimer);
  staggerTimer = window.setTimeout(() => { staggered.value = false; }, 450);
});
watch(() => pages.value.length, (count) => {
  rolled.value = Array.from({ length: count }, (_, at) => (at === page.value ? 0 : FAN_ROLL));
  if (page.value >= count) page.value = 0;
});

/** Rolls to page `next`: forward (dir 1) the page leaves to the left and the next comes in from the right. */
async function rollTo(next: number, dir: 1 | -1) {
  if (next === page.value || !root.value) return;
  staggered.value = false;
  instant.value = true;
  rolled.value[next] = -dir * FAN_ROLL;
  await nextTick();
  void root.value.offsetWidth;
  instant.value = false;
  rolled.value[page.value] = dir * FAN_ROLL;
  rolled.value[next] = 0;
  page.value = next;
}
function turn(by: 1 | -1) {
  void rollTo(fanTurn(page.value, by, pages.value.length), by);
}
function pick(at: number) {
  const delta = shortTurn(page.value, at, pages.value.length);
  if (delta !== 0) void rollTo(at, delta > 0 ? 1 : -1);
}

function place(at: number, count: number, pageAt: number, slot: number) {
  const angle = spread.value ? fanAngle(at, count) + (rolled.value[pageAt] ?? 0) : 90;
  const distance = spread.value ? radius.value : 0;
  const scale = spread.value ? fanScale(radius.value) : 0.3;
  return {
    transform: `rotate(${-angle}deg) translateX(${distance}px) rotate(${angle}deg) scale(${scale})`,
    transitionDelay: staggered.value && spread.value ? `${slot * 30}ms` : "0ms",
    // Mid-drag, both pages show, each button fading as it nears an end of the ring.
    ...(drag.value && moving(pageAt) ? { opacity: fanFade(angle) * fanDim(pageAt === page.value ? 1 - drag.value.t : drag.value.t) } : {}),
  };
}
function moving(pageAt: number) {
  return Boolean(drag.value) && (pageAt === page.value || pageAt === drag.value?.peer);
}
/** Mid-drag the wide pip stretches from this page's dot to the next one's, like the chips' pill. */
function pip(at: number) {
  const turn = drag.value;
  if (!turn) return undefined;
  const share = at === page.value ? 1 - turn.t : at === turn.peer ? turn.t : 0;
  return { width: `${6 + 10 * share}px`, transition: "none" };
}

/**
 * A sideways drag anywhere on the fan turns the page with the finger; the tap it ends with does
 * nothing else. A drag that starts mostly up or down is left alone.
 */
let start: { x: number; y: number; id: number } | null = null;
let last = { x: 0, at: 0, velocity: 0 };
let swiped = false;
function down(event: PointerEvent) {
  if (drag.value) return;
  start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  last = { x: event.clientX, at: event.timeStamp, velocity: 0 };
}
function move(event: PointerEvent) {
  if (!start || event.pointerId !== start.id || pages.value.length < 2 || !root.value) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (!drag.value) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
      if (Math.abs(dy) >= 8) start = null;
      return;
    }
    root.value.setPointerCapture?.(event.pointerId);
    staggered.value = false;
    instant.value = true;
  }
  const elapsed = event.timeStamp - last.at;
  if (elapsed > 0) last = { x: event.clientX, at: event.timeStamp, velocity: (event.clientX - last.x) / elapsed };
  const { dir, t } = fanDrag(dx, fanDragSpan(root.value.clientWidth));
  const peer = fanTurn(page.value, dir, pages.value.length);
  // Turning back past the start swaps which page comes in: the one left behind goes back out of sight.
  if (drag.value && drag.value.peer !== peer && drag.value.peer !== page.value) rolled.value[drag.value.peer] = FAN_ROLL;
  rolled.value[page.value] = dir * t * FAN_ROLL;
  if (peer !== page.value) rolled.value[peer] = -dir * (1 - t) * FAN_ROLL;
  drag.value = { peer, dir, t };
}
async function up(event: PointerEvent) {
  if (!start || event.pointerId !== start.id) return;
  start = null;
  const turn = drag.value;
  if (!turn) return;
  swiped = true;
  window.setTimeout(() => { swiped = false; }, 0);
  // A finger that stopped before letting go isn't flicking.
  const finish = fanSettles(turn.t, event.timeStamp - last.at > 80 ? 0 : last.velocity, turn.dir);
  // Hand back to the transitions from where the finger left it.
  instant.value = false;
  drag.value = null;
  await nextTick();
  if (finish) {
    rolled.value[page.value] = turn.dir * FAN_ROLL;
    rolled.value[turn.peer] = 0;
    page.value = turn.peer;
  } else {
    rolled.value[page.value] = 0;
    rolled.value[turn.peer] = -turn.dir * FAN_ROLL;
  }
}
function cancel() {
  const turn = drag.value;
  start = null;
  if (!turn) return;
  instant.value = false;
  drag.value = null;
  rolled.value[page.value] = 0;
  rolled.value[turn.peer] = -turn.dir * FAN_ROLL;
}
function scrim() {
  if (!swiped) closeSheet();
}
function key(event: KeyboardEvent) {
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    turn(event.key === "ArrowRight" ? 1 : -1);
  }
}
</script>

<template>
  <Transition name="fade" :duration="200" @after-leave="restoreFocus">
    <div
      v-if="open"
      ref="root"
      class="fan-root"
      :class="{ spread, instant }"
      role="dialog"
      aria-modal="true"
      aria-label="Add"
      tabindex="-1"
      :style="{ '--cx': `${centre.x}px`, '--cy': `${centre.y}px` }"
      @click.self="scrim"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="cancel"
      @keydown="key"
    >
      <div class="ring">
        <template v-for="(group, pageAt) in pages" :key="pageAt">
          <button
            v-for="(action, at) in group"
            :key="action.id"
            type="button"
            class="fi"
            :class="{ here: pageAt === page, peek: moving(pageAt) }"
            :style="place(at, group.length, pageAt, at)"
            :inert="pageAt !== page"
            :data-fan="action.id"
            @click="run(action.id)"
          >
            <span class="fdisc" aria-hidden="true"><Icon :name="action.icon" :size="22" :sw="2.2" /></span>
            <span class="lbl t-capn">{{ action.label }}</span>
          </button>
        </template>
      </div>
      <div v-if="pages.length > 1" class="fdots">
        <button
          v-for="(_, at) in pages"
          :key="at"
          type="button"
          class="dot"
          :class="{ on: at === page }"
          :aria-label="`Page ${at + 1} of ${pages.length}`"
          :aria-current="at === page ? 'true' : undefined"
          @click="pick(at)"
        ><span class="pip" :style="pip(at)" /></button>
      </div>
      <button type="button" class="fcog" aria-label="Arrange the + button" data-fan-cog @click="openFanPages"><Icon name="cog" :size="16" /></button>
      <button type="button" class="fclose" aria-label="Close" @click="closeSheet">
        <Icon name="plus" :size="26" :sw="2.4" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.fan-root {
  position: absolute; inset: 0; z-index: 25; background: rgba(0,0,0,.6); touch-action: none; user-select: none; -webkit-user-select: none;
  /* Inside the ring, straight up from the +: the dots, then the cog. Their 44px hits touch but don't
     overlap; the cog's icon is drawn a little above its hit's middle, halfway between the dots and the ×.
     Higher dots would meet the labels of a ring's lowest buttons. */
  --dots-up: 98px; --cog-up: 54px; --cog-lift: 7px;
}
/* A zero-size point on the +; each button is placed round it by angle and distance. */
.ring { position: absolute; left: var(--cx); top: var(--cy); width: 0; height: 0; }
.fi {
  --w: 80px;
  position: absolute; left: calc(var(--w) / -2); top: calc(var(--control-fab) / -2); width: var(--w);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-xs);
  background: transparent; color: var(--text-on-scrim); opacity: 0; visibility: hidden;
  /* Only the disc and the label take a tap: the 80px box is wider than the gap to the next button. */
  pointer-events: none;
  transition: transform 0.32s cubic-bezier(0.25, 1.25, 0.45, 1), opacity 0.2s, visibility 0s linear 0.32s;
}
.spread .fi.here { opacity: 1; visibility: visible; transition: transform 0.32s cubic-bezier(0.25, 1.25, 0.45, 1), opacity 0.2s, visibility 0s; }
.instant .fi { transition: none !important; }
/* Mid-drag the incoming page shows too; its opacity follows the finger. */
.spread .fi.peek { visibility: visible; }
.fdisc, .lbl { pointer-events: auto; }
.fdisc {
  width: var(--control-fab); height: var(--control-fab); border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-action); color: var(--color-on-action); box-shadow: var(--d-action), var(--d-float);
}
.fi:active .fdisc { filter: brightness(0.92); }
/* Grows with the text size up to 13px (11px normally), like the tab bar's fixed labels: a ring has no room for more. */
.lbl { font-size: min(0.6471rem, 13px); line-height: 1.25; white-space: nowrap; text-shadow: 0 1px 4px rgb(0 0 0 / 0.7); }
/* The dots sit inside the ring, between the + and the buttons. */
.fdots { position: absolute; left: var(--cx); top: calc(var(--cy) - var(--dots-up) - var(--control-hit) / 2); transform: translateX(-50%); display: flex; }
.fcog {
  position: absolute; z-index: 1; left: calc(var(--cx) - var(--control-hit) / 2); top: calc(var(--cy) - var(--cog-up) - var(--control-hit) / 2);
  width: var(--control-hit); height: var(--control-hit); display: flex; align-items: center; justify-content: center;
  background: transparent; color: var(--text-on-scrim); opacity: 0.75; border-radius: 50%;
}
.fcog > :deep(svg) { translate: 0 calc(-1 * var(--cog-lift)); }
.dot { width: var(--control-hit); height: var(--control-hit); display: flex; align-items: center; justify-content: center; background: transparent; color: var(--text-on-scrim); opacity: 0.5; }
.dot.on { opacity: 1; }
.pip { width: 6px; height: 6px; border-radius: var(--radius-pill); background: currentColor; transition: width 0.2s; }
.dot.on .pip { width: 16px; }
/* The close button lies exactly over the + and turns it into ×. */
.fclose {
  position: absolute; left: calc(var(--cx) - var(--control-fab) / 2); top: calc(var(--cy) - var(--control-fab) / 2);
  width: var(--control-fab); height: var(--control-fab); border-radius: var(--radius-pill);
  background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center;
  box-shadow: var(--d-action);
}
.fclose :deep(svg) { transition: transform 0.25s cubic-bezier(0.3, 1.4, 0.5, 1); }
.spread .fclose :deep(svg) { transform: rotate(45deg); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .fi, .spread .fi.here, .pip, .fclose :deep(svg), .fade-enter-active, .fade-leave-active { transition: none; }
}
</style>
