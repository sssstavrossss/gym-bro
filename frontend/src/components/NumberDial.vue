<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { useDialogFocus } from "../lib/focusTrap";
import { arcGap, arcPlace, arcSteps, dialText, indexOf, stepText, tidy, typedValue, valueAt, wheel, ARC_RADIUS } from "../lib/dial";
import { rememberedStep, rememberStep } from "../state/dialSteps";
import { closeDial, keepDial, ui } from "../ui";

/**
 * The number wheel, "the arc" (README, *Picking a number*): the numbers on a ring round the ✓, on a dark scrim like the
 * + fan, springing out of the number tapped. A flick flies and a slow drag moves one step; it always lands on a step,
 * because the gesture is the browser's own scrolling (momentum and snap) on a see-through strip, and the numbers are
 * drawn from where that strip is. The steps are the preset's (lib/dial.ts); the person can pick another, and it is
 * kept for next time. ↺ goes back to where it started, × or the scrim cancel. On a keyboard: ←/→ step, digits type a
 * number, Enter keeps it, Esc cancels.
 */
const spec = computed(() => ui.dial?.spec ?? null);
const open = computed(() => spec.value != null);
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
useDialogFocus(() => open.value, root);

/** Width of one step on the strip, in px. */
const SLOT = 40;
const step = ref(1);
/** The value it opened on, for ↺. */
const start = ref(0);
/** The value the wheel's steps count from: where it opened, or the value when the step was changed. */
const anchor = ref(0);
/** Where the strip is, in steps from the lowest value (fractional while it moves). */
const at = ref(0);
/** False for the first frame, so it springs out of the number tapped. */
const shown = ref(false);
/** Digits typed on a keyboard, while they are being typed. */
const typed = ref("");

const w = computed(() => (spec.value ? wheel(anchor.value, step.value, spec.value.min, spec.value.max) : { first: 0, step: 1, count: 1 }));
const index = computed(() => Math.max(0, Math.min(w.value.count - 1, Math.round(at.value))));
const current = computed(() => valueAt(w.value, index.value));
const text = (value: number) => (spec.value ? dialText(value, spec.value.format, step.value, anchor.value) : "");
const gap = computed(() => arcGap(text(current.value)));
/** The numbers drawn: the ones near the top of the ring. */
const near = computed(() => {
  const lo = Math.max(0, Math.floor(at.value) - 7);
  const hi = Math.min(w.value.count - 1, Math.ceil(at.value) + 7);
  return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
});
function place(i: number) {
  const p = arcPlace(i - at.value, gap.value);
  return {
    transform: `translate(calc(${p.x.toFixed(1)}px - 50%), calc(${p.y.toFixed(1)}px - 50%)) scale(${p.scale.toFixed(3)})`,
    opacity: p.opacity.toFixed(3),
  };
}

let frame = 0;
function onScroll() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (scroller.value) at.value = scroller.value.scrollLeft / SLOT;
  });
}
async function centreOn(value: number) {
  anchor.value = value;
  await nextTick();
  const i = indexOf(w.value, value);
  scroller.value?.scrollTo({ left: i * SLOT, behavior: "instant" });
  at.value = i;
}

watch(spec, async (now, before) => {
  if (!now || now === before) return;
  const kept = rememberedStep(now.id);
  step.value = kept != null && now.steps.includes(kept) ? kept : now.step;
  start.value = now.value;
  typed.value = "";
  shown.value = false;
  await centreOn(now.value);
  // The strip takes the keys at once, so the focus trap leaves focus there.
  scroller.value?.focus({ preventScroll: true });
  requestAnimationFrame(() => requestAnimationFrame(() => (shown.value = true)));
});

/** The spring starts at the number tapped. */
const from = computed(() => {
  const origin = ui.dial?.origin;
  if (!origin || typeof window === "undefined") return { x: "0px", y: "24px" };
  return { x: `${(origin.x - window.innerWidth / 2).toFixed(0)}px`, y: `${(origin.y - window.innerHeight).toFixed(0)}px` };
});

function pickStep(next: number) {
  const value = current.value;
  step.value = next;
  void centreOn(value);
}
function reset() {
  void centreOn(start.value);
}
function close() {
  closeDial();
}
function save() {
  if (!spec.value) return;
  rememberStep(spec.value.id, step.value);
  keepDial(current.value, step.value);
}
function nudge(by: number) {
  scroller.value?.scrollBy({ left: by * SLOT, behavior: "smooth" });
}
/** A tap on a number goes to it. */
function tap(event: MouseEvent) {
  const el = scroller.value;
  if (!el) return;
  const box = el.getBoundingClientRect();
  const by = arcSteps(event.clientX - (box.left + box.width / 2), gap.value);
  if (by) nudge(by);
}
/** A mouse wheel or a trackpad's up and down turn the ring too. */
function onWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  scroller.value?.scrollBy({ left: event.deltaY });
}
let typing = 0;
function typeKey(key: string) {
  if (!spec.value) return;
  window.clearTimeout(typing);
  const next = typed.value + key;
  const value = typedValue(next, spec.value.format);
  if (value == null && key !== ".") return;
  typed.value = next;
  if (value != null) void centreOn(tidy(Math.min(spec.value.max, Math.max(spec.value.min, value)), step.value));
  // A pause starts the next number afresh.
  typing = window.setTimeout(() => (typed.value = ""), 1500);
}
function key(event: KeyboardEvent) {
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") nudge(-1);
  else if (event.key === "ArrowRight" || event.key === "ArrowUp") nudge(1);
  else if (event.key === "Enter") save();
  else if (event.key === "Escape") close();
  else if (/^[\d.,]$/.test(event.key)) typeKey(event.key === "," ? "." : event.key);
  else if (event.key === "Backspace") typed.value = typed.value.slice(0, -1);
  else return;
  event.preventDefault();
  event.stopPropagation();
}
</script>

<template>
  <Transition name="fade" :duration="200">
    <div
      v-if="spec" ref="root" class="dial-root" :class="{ shown }" role="dialog" aria-modal="true" :aria-label="spec.label"
      :style="{ '--ox': from.x, '--oy': from.y, '--slot': `${SLOT}px`, '--arc-r': `${ARC_RADIUS}px` }"
      data-dial @click.self="close" @keydown="key"
    >
      <div class="col top" @click.self="close">
        <span class="t-label dlabel">{{ spec.label }}</span>
        <span v-if="spec.hint" class="t-capn dhint">{{ spec.hint }}</span>
        <span v-if="spec.live" class="t-capn dlive tnum" aria-live="polite" data-dial-live>{{ spec.live(current) }}</span>
      </div>
      <div class="row steps" role="group" aria-label="Step">
        <template v-if="spec.steps.length > 1">
          <span class="t-capn dhint">Step</span>
          <button
            v-for="s in spec.steps" :key="s" type="button" class="chip ring t-label tnum" :class="{ on: s === step }" :aria-pressed="s === step"
            :data-dial-step="s" @click="pickStep(s)"
          >{{ stepText(s, spec.format) }}</button>
        </template>
      </div>
      <div class="arcspace" @click.self="close" />
      <div class="row bottom">
        <div class="point">
          <div class="arcring" aria-hidden="true">
            <span v-for="i in near" :key="i" class="an tnum" :class="{ mid: i === index }" :style="place(i)">{{ text(valueAt(w, i)) }}</span>
            <span class="readout tnum" data-dial-value>{{ text(current) }}<span class="t-body runit">{{ spec.unit }}</span></span>
          </div>
        </div>
        <button type="button" class="cbtn scrimbtn" :disabled="current === tidy(start, step)" :aria-label="`Back to ${text(start)} ${spec.unit}`" data-dial-reset @click="reset"><Icon name="undo" :size="18" /></button>
        <button type="button" class="ok" :aria-label="`Keep ${text(current)} ${spec.unit}`" data-dial-keep @click="save"><Icon name="check" :size="26" :sw="2.6" /></button>
        <button type="button" class="cbtn scrimbtn" aria-label="Cancel" data-dial-cancel @click="close"><Icon name="x" :size="18" /></button>
      </div>
      <!-- The gesture: a see-through strip over the ring, scrolled by the finger. -->
      <div
        ref="scroller" class="track" tabindex="0" role="slider" :aria-label="spec.label" :aria-valuenow="current" :aria-valuemin="spec.min" :aria-valuemax="spec.max"
        :aria-valuetext="`${text(current)} ${spec.unit}`" data-dial-track @scroll="onScroll" @click="tap" @wheel="onWheel"
      >
        <span v-for="i in w.count" :key="`${step}-${i}`" class="slot" />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dial-root {
  position: fixed; inset: 0; z-index: var(--z-dial); display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
  gap: var(--space-m); padding: 0 var(--space-screen) calc(var(--sab) + var(--space-m));
  background: var(--scrim-dial); color: var(--text-on-scrim); user-select: none; -webkit-user-select: none;
}
.tnum { font-variant-numeric: tabular-nums; }
.top { align-items: center; gap: var(--space-2xs); text-align: center; }
.dlabel { opacity: .85; }
.dhint { opacity: .7; }
.dlive { opacity: .85; }

/* Every part springs out of the number tapped, on the fan's curve. */
.dial-root > :not(.track) { transition: transform var(--fan-time) var(--fan-spring), opacity .2s; }
.dial-root:not(.shown) > :not(.track) { transform: translate(var(--ox), var(--oy)) scale(.4); opacity: 0; transition: none; }
.dial-root.shown > .bottom { transition-delay: 60ms; }
.dial-root:not(.shown) .arcring { transform: scale(.2); opacity: 0; }
.arcring { transition: transform .4s var(--fan-spring), opacity .2s; }

/* The strip the finger scrolls: see-through, over the ring. */
.track {
  position: absolute; left: 0; right: 0; z-index: 2; display: flex; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;
  padding-inline: calc(50% - var(--slot) / 2); scrollbar-width: none; overscroll-behavior-x: contain;
  bottom: calc(var(--sab) + var(--space-m) + var(--control-fab) / 2 + var(--space-xl)); height: var(--arc-r);
}
.track::-webkit-scrollbar { display: none; }
/* Its focus shows on the readout instead. */
.track:focus-visible { outline: none; }
.slot { flex: none; width: var(--slot); scroll-snap-align: center; }
.dial-root:has(.track:focus-visible) .readout { outline: var(--line-rail) solid var(--text-on-scrim); outline-offset: var(--space-s); border-radius: var(--radius-m); }

.row.steps { gap: var(--space-xs); flex-wrap: nowrap; justify-content: center; min-height: var(--control-hit); order: -1; }
.top { order: -2; }
.steps .chip { color: var(--text-on-scrim); }
.steps .chip.ring::before { box-shadow: inset 0 0 0 1px var(--scrim-line); }
.steps .chip.ring.on::before { box-shadow: inset 0 0 0 var(--line-rail) var(--text-on-scrim); }
.steps .chip.ring.on { color: var(--text-on-scrim); }

.arcspace { width: 100%; height: calc(var(--arc-r) + var(--space-s)); }
.point { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.arcring { position: absolute; left: 0; top: 0; width: 0; height: 0; }
/* Capped in px like the fan's labels: the ring's spacing is in degrees, so bigger numbers would run into each other. */
.an { position: absolute; left: 0; top: 0; font-size: min(1.15rem, 21px); font-weight: 600; white-space: nowrap; will-change: transform, opacity; }
.an.mid { color: var(--color-action); font-weight: 700; }
.readout {
  position: absolute; left: 0; top: calc(var(--arc-r) * -0.48); transform: translate(-50%, -50%);
  font-size: min(2.6rem, 48px); font-weight: 700; letter-spacing: -0.03em; line-height: 1.05; white-space: nowrap;
}
.runit { margin-left: var(--space-xs); opacity: .7; font-weight: 500; letter-spacing: 0; font-size: min(1rem, 20px); }

.row.bottom { position: relative; gap: var(--space-xl); flex-wrap: nowrap; justify-content: center; align-items: center; }
.scrimbtn { color: var(--text-on-scrim); z-index: 3; }
.scrimbtn::before { background: var(--scrim-button); }
.ok {
  position: relative; z-index: 3; width: var(--control-fab); height: var(--control-fab); border-radius: var(--radius-pill); border: 0;
  background: var(--color-action); color: var(--color-on-action); display: flex; align-items: center; justify-content: center; box-shadow: var(--d-action);
}
.ok:active { transform: scale(.92); }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .dial-root > *, .dial-root:not(.shown) > *, .arcring { transition: none !important; }
}
</style>
