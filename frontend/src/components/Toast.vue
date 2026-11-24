<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { isThrow, TOAST_SHOWN } from "../lib/toastQueue";
import { vp } from "../lib/viewport";
import { dismissToast, holdToast, runToastAction, ui } from "../ui";
import Icon from "./Icon.vue";

/*
 * The toast stack. The front toast is readable and counting down; the next one shows only its top edge behind
 * it, like a closed stack of notifications; the rest wait unseen. Toasts sit at the bottom of the screen: above
 * the tab bar on a page, and above the lowest bar of an open sheet (anything marked `data-toast-floor`).
 */
const shown = computed(() => ui.toasts.slice(0, TOAST_SHOWN));
const lift = computed(() => ui.selecting && !ui.sheet);

/** Distance from the bottom of the screen while a sheet is open on a phone or tablet. Null: the page's spot. */
const floor = ref<number | null>(null);
const frontHeight = ref(0);
const frontEl = ref<HTMLElement | null>(null);

function measureFloor(): number | null {
  if (vp.desktop || !ui.sheet) return null;
  const height = window.innerHeight;
  let top = height;
  for (const el of document.querySelectorAll<HTMLElement>("[data-toast-floor]")) {
    const box = el.getBoundingClientRect();
    // Only bars that sit low on the screen count; a button in the middle of a short page doesn't.
    if (box.height > 0 && box.top > height * 0.45 && box.top < top) top = box.top;
  }
  return top < height ? Math.ceil(height - top) : null;
}

// The bars under a sheet come and go (the keyboard hides the added bar, the amount screen opens), so the spot is
// followed for as long as a toast shows.
let frame = 0;
function follow() {
  const next = measureFloor();
  if (next !== floor.value) floor.value = next;
  if (frontEl.value) frontHeight.value = frontEl.value.offsetHeight;
  frame = ui.toasts.length ? requestAnimationFrame(follow) : 0;
}
watch(() => ui.toasts.length > 0, (any) => {
  if (any && !frame) frame = requestAnimationFrame(follow);
}, { immediate: true, flush: "post" });
onBeforeUnmount(() => cancelAnimationFrame(frame));

const place = computed(() => (floor.value != null ? { bottom: `calc(${floor.value}px + var(--space-m))` } : {}));

/*
 * A mouse that moves onto the toast holds it. Only a real move counts: a toast that appears under a resting
 * pointer still counts down, or it would never go.
 */
let hovered: number | null = null;

/* Swipe: the front toast follows the finger and is thrown off in whichever direction it was let go. */
const drag = ref<{ id: number; x: number; y: number; at: number; dx: number; dy: number } | null>(null);
const thrown = ref<{ id: number; dx: number; dy: number } | null>(null);

function down(event: PointerEvent, id: number) {
  if ((event.target as HTMLElement).closest("button")) return;
  drag.value = { id, x: event.clientX, y: event.clientY, at: Date.now(), dx: 0, dy: 0 };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  holdToast(true);
}
function move(event: PointerEvent, id: number) {
  if (!drag.value) {
    hover(event, id);
    return;
  }
  drag.value.dx = event.clientX - drag.value.x;
  drag.value.dy = event.clientY - drag.value.y;
}
function up() {
  const d = drag.value;
  if (!d) return;
  drag.value = null;
  if (!isThrow(d.dx, d.dy, Date.now() - d.at)) {
    // A mouse still resting on it keeps holding it.
    if (hovered !== d.id) holdToast(false);
    return;
  }
  const scale = 480 / Math.max(Math.hypot(d.dx, d.dy), 1);
  thrown.value = { id: d.id, dx: d.dx * scale, dy: d.dy * scale };
  window.setTimeout(() => {
    dismissToast(d.id);
    if (thrown.value?.id === d.id) thrown.value = null;
  }, 180);
}
function hover(event: PointerEvent, id: number) {
  if (event.pointerType !== "mouse" || hovered === id || ui.toasts[0]?.id !== id) return;
  hovered = id;
  holdToast(true);
}
function leave(event: PointerEvent, id: number) {
  if (event.pointerType !== "mouse" || hovered !== id) return;
  hovered = null;
  if (!drag.value) holdToast(false);
}

function moved(id: number): Record<string, string> {
  if (thrown.value?.id === id) return { transform: `translate(${thrown.value.dx}px, ${thrown.value.dy}px)`, opacity: "0" };
  if (drag.value?.id === id) {
    const fade = 1 - Math.min(0.6, Math.hypot(drag.value.dx, drag.value.dy) / 300);
    return { transform: `translate(${drag.value.dx}px, ${drag.value.dy}px)`, opacity: String(fade), transition: "none" };
  }
  return {};
}
function setFront(el: unknown, index: number) {
  if (index === 0) frontEl.value = el as HTMLElement | null;
}
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toasts">
    <div
      v-for="(item, index) in shown"
      :key="item.id"
      :ref="(el) => setFront(el, index)"
      class="toast"
      :class="{ front: index === 0, back: index > 0, lift }"
      :style="[place, index > 0 && frontHeight ? { height: `${frontHeight}px` } : {}, index === 0 ? moved(item.id) : {}]"
      :role="item.error ? 'alert' : 'status'"
      :aria-hidden="index > 0 ? 'true' : undefined"
      :data-toast-id="item.id"
      @pointerdown="index === 0 && down($event, item.id)"
      @pointermove="index === 0 && move($event, item.id)"
      @pointerup="up"
      @pointercancel="up"
      @pointerleave="leave($event, item.id)"
    >
      <Icon v-if="item.error" name="alert" :size="16" class="alert" />
      <span class="t-label grow msg">{{ item.text }}</span>
      <button v-if="item.action" type="button" class="btn sm primary t-label undo" :tabindex="index > 0 ? -1 : undefined" @click="runToastAction">{{ item.action.label }}</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts { display: contents; }
.toast {
  position: absolute; left: var(--space-l); right: var(--space-l); bottom: calc(var(--tabbar-h) + var(--space-m)); z-index: 60;
  display: flex; align-items: center; gap: var(--space-m); padding: var(--space-m) var(--space-l); border-radius: var(--radius-l);
  background: var(--color-surface); color: var(--text-primary); box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: calc(100% - 32px);
  box-sizing: border-box; touch-action: none; user-select: none; -webkit-user-select: none; transform-origin: 50% 0;
  transition: transform .26s cubic-bezier(.2, .8, .2, 1), opacity .26s, filter .26s;
}
.msg { color: var(--text-primary); overflow-wrap: anywhere; }
.alert { flex: none; color: var(--text-secondary); }
/* The next one waits behind: only its top edge shows, a little narrower and darker. */
.toast.back { z-index: 59; transform: translateY(calc(-1 * var(--space-s) - var(--space-2xs))) scale(.94); filter: brightness(.72); pointer-events: none; }
.toast.back > * { visibility: hidden; }
.is-tablet .toast { left: 50%; right: auto; width: 440px; margin-left: -220px; }
.is-desktop .toast { left: 264px; right: auto; bottom: 24px; width: 420px; }
.toast.lift { bottom: calc(140px + max(var(--sab), 12px)); }
.is-desktop .toast.lift { bottom: 140px; }
.undo { margin: calc((var(--control-chip) - var(--control-hit)) / 2) 0; }
/* Over a sheet, keep it near the default size so the largest text doesn't cover the sheet. */
:global(html.dt-xl) .toast .t-label { font-size: 15px; line-height: 1.3; }
.toast-enter-from { opacity: 0; transform: translateY(var(--space-s)); }
.toast-enter-from.back { transform: translateY(calc(-1 * var(--space-s) - var(--space-2xs))) scale(.9); }
.toast-leave-to { opacity: 0; transform: translateY(var(--space-s)); }
.toast-leave-active { transition: transform .2s, opacity .2s; }
</style>
