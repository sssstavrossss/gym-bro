<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { wrapTurn } from "../lib/carousel";
import type { SwipeSample } from "../lib/weekSwipe";

const props = withDefaults(defineProps<{
  count: number;
  height?: number;
  lockIndex?: number;
  remember?: boolean;
  storageKey?: string;
  label?: string;
  /** Home only: the strip takes half the layout height. The 44px hit box overlaps it. */
  tight?: boolean;
  /** Names for the dots ("Weight", "Calories"…), read out instead of "Panel 2 of 6". */
  names?: string[];
}>(), { remember: false, lockIndex: -1, tight: false });
const emit = defineEmits<{ change: [index: number] }>();

const track = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
const index = ref(0);
const width = ref(0);
const locked = ref<number | null>(null);
const reduce = ref(false);
/** True while a wrap scrolls across the middle pages; snapping is off and the pages it passes are not "shown". */
const wrapping = ref(false);

const visualOnly = computed(() => props.count * 44 > width.value && width.value > 0);
const trackStyle = computed(() => {
  const height = props.height ?? locked.value;
  return height ? { height: `${height}px` } : undefined;
});

function storedIndex(): number {
  if (!props.remember || !props.storageKey) return 0;
  try {
    const raw = Number(localStorage.getItem(props.storageKey));
    return Number.isInteger(raw) && raw >= 0 && raw < props.count ? raw : 0;
  } catch {
    return 0;
  }
}

/** Saves the page when `remember` is on, and tells the parent which page is showing. */
function remember() {
  emit("change", index.value);
  if (!props.remember || !props.storageKey) return;
  try {
    localStorage.setItem(props.storageKey, String(index.value));
  } catch {
    // Private mode can reject storage. The page still changes.
  }
}

function go(next: number, behavior?: ScrollBehavior) {
  const trackEl = track.value;
  if (!trackEl || props.count < 1) return;
  const clamped = Math.max(0, Math.min(props.count - 1, next));
  // Snap-stop would halt a smooth scroll on the next page, so a jump of more than one page is instant.
  const far = Math.abs(clamped - index.value) > 1;
  index.value = clamped;
  remember();
  const motion = behavior ?? (reduce.value || far ? "auto" : "smooth");
  trackEl.scrollTo({ left: clamped * trackEl.clientWidth, behavior: motion });
}

/** Next and previous wrap like a carousel: past the last page is the first, before the first is the last. */
function step(by: 1 | -1) {
  const count = props.count;
  if (count < 2) return;
  const next = index.value + by;
  if (next >= 0 && next < count) go(next);
  else wrapTo(next < 0 ? count - 1 : 0);
}

let wrapTimer = 0;
let settleWrap: (() => void) | null = null;
let wrapDest = 0;

/**
 * Wraps like a carousel without rewinding across the cards. For last → first, the first card is
 * moved (CSS order) to sit after the last and the track scrolls one page on, so it slides in like
 * any next card. Once it lands, the order is put back and the track jumps to the real first page,
 * which looks the same. First → last is the mirror image.
 */
function wrapTo(target: number) {
  const trackEl = track.value;
  const count = props.count;
  if (!trackEl || count < 2) return;
  if (reduce.value) {
    go(target, "auto");
    return;
  }
  settleWrap?.();
  const width = trackEl.clientWidth;
  const forward = target === 0;
  const moved = trackEl.children.item(forward ? 0 : count - 1) as HTMLElement | null;
  if (!moved) {
    go(target, "auto");
    return;
  }
  index.value = target;
  remember();
  wrapping.value = true;
  moved.style.order = forward ? "1" : "-1";
  // The other cards shift by one page; keep the card on screen where it is.
  trackEl.scrollLeft = forward ? (count - 2) * width : width;
  wrapDest = forward ? (count - 1) * width : 0;
  const settle = () => {
    if (settleWrap !== settle) return;
    settleWrap = null;
    window.clearTimeout(wrapTimer);
    trackEl.removeEventListener("scrollend", settle);
    moved.style.order = "";
    trackEl.scrollLeft = target * trackEl.clientWidth;
    wrapping.value = false;
  };
  settleWrap = settle;
  trackEl.addEventListener("scrollend", settle);
  // Safari before scrollend support lands through onScroll reaching the end, or this.
  wrapTimer = window.setTimeout(settle, 700);
  trackEl.scrollTo({ left: wrapDest, behavior: "smooth" });
}

/** A drag that starts on the first or last card and pulls past its end wraps around. */
let touch: { x: number; y: number; edge: "first" | "last" | null; inner: boolean; samples: SwipeSample[] } | null = null;

function atEdge(trackEl: HTMLElement): "first" | "last" | null {
  const max = trackEl.scrollWidth - trackEl.clientWidth;
  if (index.value === props.count - 1 && trackEl.scrollLeft >= max - 2) return "last";
  if (index.value === 0 && trackEl.scrollLeft <= 2) return "first";
  return null;
}

/** A chart or list inside a card that scrolls sideways keeps its own swipe. */
function insideScroller(target: EventTarget | null, trackEl: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== trackEl) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

function onTouchStart(event: TouchEvent) {
  const trackEl = track.value;
  if (!trackEl || props.count < 2 || event.touches.length !== 1 || wrapping.value) {
    touch = null;
    return;
  }
  const point = event.touches[0];
  touch = {
    x: point.clientX,
    y: point.clientY,
    edge: atEdge(trackEl),
    inner: insideScroller(event.target, trackEl),
    samples: [{ t: event.timeStamp, x: point.clientX }],
  };
}

function onTouchMove(event: TouchEvent) {
  const point = event.touches[0];
  if (!touch || !touch.edge || !point) return;
  touch.samples.push({ t: event.timeStamp, x: point.clientX });
  // The last ~100 ms is the flick speed.
  while (touch.samples.length > 2 && event.timeStamp - touch.samples[0].t > 100) touch.samples.shift();
}

function onTouchEnd(event: TouchEvent) {
  const start = touch;
  touch = null;
  const trackEl = track.value;
  if (!start || !start.edge || start.inner || !trackEl) return;
  const point = event.changedTouches[0];
  if (!point) return;
  const samples = [...start.samples, { t: event.timeStamp, x: point.clientX }];
  const turn = wrapTurn(start.edge, point.clientX - start.x, point.clientY - start.y, samples);
  // Still on the same end card: the drag pulled past it rather than paging.
  if (!turn || atEdge(trackEl) !== start.edge) return;
  wrapTo(turn === 1 ? 0 : props.count - 1);
}

function onTouchCancel() {
  touch = null;
}

function onScroll() {
  const trackEl = track.value;
  if (!trackEl || trackEl.clientWidth < 1) return;
  if (wrapping.value) {
    if (Math.abs(trackEl.scrollLeft - wrapDest) < 1) settleWrap?.();
    return;
  }
  const next = Math.round(trackEl.scrollLeft / trackEl.clientWidth);
  if (next !== index.value && next >= 0 && next < props.count) {
    index.value = next;
    remember();
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    step(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  }
}

async function measure() {
  await nextTick();
  const trackEl = track.value;
  if (!trackEl) return;
  width.value = trackEl.clientWidth;
  if (props.height || props.lockIndex < 0) {
    if (props.lockIndex < 0 && !props.height) locked.value = null;
    return;
  }
  const panel = trackEl.children.item(props.lockIndex) as HTMLElement | null;
  if (!panel) return;
  const previous = trackEl.style.height;
  trackEl.style.height = "auto";
  panel.style.flex = "0 0 auto";
  panel.style.height = "auto";
  locked.value = panel.scrollHeight;
  panel.style.flex = "";
  panel.style.height = "";
  trackEl.style.height = previous;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  reduce.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  index.value = storedIndex();
  emit("change", index.value);
  void measure().then(() => go(index.value, "auto"));
  observer = new ResizeObserver(() => { void measure(); });
  if (root.value) observer.observe(root.value);
  window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  settleWrap?.();
  observer?.disconnect();
  window.removeEventListener("resize", measure);
});
watch(() => [props.count, props.lockIndex, props.height], () => { void measure(); });

defineExpose({ go, step, index });
</script>

<template>
  <div ref="root" class="panels" :class="{ tight }">
    <div ref="track" class="track" :class="{ fixed: height != null, wrapping }" :style="trackStyle" tabindex="0" :aria-label="label" @keydown="onKey" @scroll.passive="onScroll" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend.passive="onTouchEnd" @touchcancel.passive="onTouchCancel">
      <slot />
    </div>
    <div v-if="count > 1" class="strip" :class="{ halves: visualOnly }">
      <button
        v-for="dot in count"
        :key="dot"
        type="button"
        class="dot"
        :class="{ on: index === dot - 1 }"
        :tabindex="visualOnly ? -1 : 0"
        :aria-hidden="visualOnly ? 'true' : undefined"
        :aria-label="visualOnly ? undefined : (names?.[dot - 1] ?? `Panel ${dot} of ${count}`)"
        :aria-current="!visualOnly && index === dot - 1 ? 'true' : undefined"
        @click="visualOnly ? undefined : go(dot - 1)"
      ><span class="pip" /></button>
      <template v-if="visualOnly">
        <button type="button" class="half back" aria-label="Previous panel" @click="step(-1)" />
        <button type="button" class="half forward" aria-label="Next panel" @click="step(1)" />
      </template>
    </div>
    <button type="button" class="edge left" aria-label="Previous panel" @click="step(-1)" />
    <button type="button" class="edge right" aria-label="Next panel" @click="step(1)" />
  </div>
</template>

<style scoped>
.panels { position: relative; min-width: 0; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.track:focus { outline: none; }
.track:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: -2px; }
.track {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  min-width: 0;
}
.track.fixed { flex: 0 0 auto; }
/* Snapping off while the wrapped card slides in, so the jump back is not re-snapped mid-way. */
.track.wrapping { scroll-snap-type: none; }
.track.wrapping > :deep(*) { scroll-snap-stop: normal; }
.track::-webkit-scrollbar { display: none; }
.track > :deep(*) {
  flex: 0 0 100%;
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.strip { display: flex; justify-content: center; flex: none; height: 44px; position: relative; }
.dot {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  padding: 0;
  color: var(--text-tertiary);
}
.pip { width: 6px; height: 6px; border-radius: var(--radius-pill); background: currentColor; }
.dot.on { color: var(--text); }
.dot.on .pip { width: 16px; }
.halves .dot { pointer-events: none; }
.half {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  background: none;
  border: 0;
  padding: 0;
}
.half.back { left: 0; }
.half.forward { right: 0; }
.edge {
  position: absolute;
  top: 0;
  bottom: 44px;
  width: 24px;
  background: none;
  border: 0;
  padding: 0;
}
.edge.left { left: 0; }
.edge.right { right: 0; }
/* 6px of space, the 6px dots, 6px of space. The 44px hit box reaches 13px past each side. */
.tight .strip { height: 18px; }
.tight .dot { height: 44px; margin-top: -13px; margin-bottom: -13px; }
.tight .half { top: -13px; height: 44px; bottom: auto; }
.tight .edge { bottom: 31px; }
@media (prefers-reduced-motion: reduce) {
  .track { scroll-behavior: auto; }
}
</style>
