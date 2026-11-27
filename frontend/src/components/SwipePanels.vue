<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";
import { shortTurn, wrapTurn } from "../lib/carousel";
import type { SwipeSample } from "../lib/weekSwipe";

const props = withDefaults(defineProps<{
  count: number;
  height?: number;
  lockIndex?: number;
  remember?: boolean;
  storageKey?: string;
  label?: string;
  /** A 30px dot strip: 12px either side of the dots. The 44px hit box overlaps it. */
  tight?: boolean;
  /** Names for the dots ("Weight", "Calories"…), read out instead of "Panel 2 of 6". */
  names?: string[];
  /** The page to open on when `remember` is off. */
  start?: number;
  /** Adds a cog at the end of the dot strip with this label ("Choose progress pages"). */
  settings?: string;
  /** Holds the page: no swiping, no dots. Add food's pages while a search is open. */
  hold?: boolean;
  /**
   * Hides the pages that aren't showing once the track is still, so a screen reader, Tab and a
   * test find only the page in view. They show again the moment the track moves (not on touch, or
   * iOS drops the tap), but stay inert, so only the page being turned to can be tapped while they slide.
   */
  hideOffscreen?: boolean;
  /** The 24px tap strips at the sides that turn the page. Off where a row's buttons reach the edge. */
  edges?: boolean;
  /**
   * Another control names the pages (Add food's chips), so the dots only show where you are: still
   * tappable, but out of Tab and the accessibility tree, so the page names aren't announced twice.
   */
  quietDots?: boolean;
}>(), { remember: false, lockIndex: -1, tight: false, start: 0, hold: false, hideOffscreen: false, edges: true, quietDots: false });
/**
 * `progress` is the page in view as a fraction while the track moves (1.5 is halfway from the second
 * page to the third). While a wrap slides past an end it runs from -1 to `count`.
 */
const emit = defineEmits<{ change: [index: number]; settings: []; progress: [position: number] }>();

const track = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
const index = ref(0);
const width = ref(0);
const locked = ref<number | null>(null);
const reduce = ref(false);
/** True while a wrap or a jump of several pages glides across the middle pages; snapping is off and the pages it passes are not "shown". */
const wrapping = ref(false);
/** False from the start of a swipe or turn until the track has settled; `hideOffscreen` shows every page meanwhile. */
const still = ref(true);

/** The cog takes 44px at the right; the same at the left keeps the dots centred. */
const dotRoom = computed(() => width.value - (props.settings ? 88 : 0));
const visualOnly = computed(() => props.count * 44 > dotRoom.value && width.value > 0);
/** Dots a screen reader and Tab skip: too many to tap, or named elsewhere. */
const unnamed = computed(() => visualOnly.value || props.quietDots);
const trackStyle = computed(() => {
  const height = props.height ?? locked.value;
  return height ? { height: `${height}px` } : undefined;
});

function storedIndex(): number {
  if (!props.remember || !props.storageKey) return Math.max(0, Math.min(props.count - 1, props.start));
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
  index.value = clamped;
  remember();
  const motion = behavior ?? (reduce.value ? "auto" : "smooth");
  if (motion === "auto") {
    trackEl.scrollTo({ left: clamped * trackEl.clientWidth, behavior: "auto" });
    emit("progress", clamped);
    return;
  }
  moving();
  // A turn glides with snapping off (snap-stop would halt it on the next page), and the page doesn't follow
  // the scroll meanwhile, so a smooth scroll the browser cuts short can't quietly turn back.
  glide(trackEl, clamped * trackEl.clientWidth, 0, null);
}

/** Turns to a page the short way round, wrapping when that is shorter: from the last page, the first is one step on. */
function turn(target: number) {
  const count = props.count;
  if (count < 2 || target === index.value) return;
  if (props.hold) {
    go(target, "auto");
    return;
  }
  const delta = shortTurn(index.value, target, count);
  const next = index.value + delta;
  if (Math.abs(delta) === 1 && (next < 0 || next >= count)) wrapTo(target);
  else go(target);
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
/** While a wrap slides, the track's order is shifted by one page: this turns its scroll position back into a page. */
let wrapShift = 0;

/** Scrolls smoothly to `dest` with snapping off, then calls `done` and snaps again. */
function glide(trackEl: HTMLElement, dest: number, shift: number, done: (() => void) | null) {
  wrapping.value = true;
  wrapDest = dest;
  wrapShift = shift;
  const settle = () => {
    if (settleWrap !== settle) return;
    settleWrap = null;
    window.clearTimeout(wrapTimer);
    trackEl.removeEventListener("scrollend", ended);
    // Land exactly, even if the smooth scroll stopped short (WebKit can drop one mid-way).
    if (Math.abs(trackEl.scrollLeft - dest) >= 2) trackEl.scrollTo({ left: dest, behavior: "auto" });
    done?.();
    wrapShift = 0;
    wrapping.value = false;
    rest();
  };
  // A wrap first jumps the track by a page, and that jump ends with a scrollend of its own: only the glide's end settles.
  const ended = () => {
    if (Math.abs(trackEl.scrollLeft - dest) < 2) settle();
  };
  settleWrap = settle;
  trackEl.addEventListener("scrollend", ended);
  // Safari before scrollend support lands through onScroll reaching the end, or this.
  wrapTimer = window.setTimeout(settle, 700);
  trackEl.scrollTo({ left: dest, behavior: "smooth" });
}

let stillTimer = 0;
let touching = false;
/** A swipe or turn has started: every page shows until the track settles. */
function moving() {
  window.clearTimeout(stillTimer);
  still.value = false;
}
/** Marks the track still once it has stopped and no finger is on it. */
function rest(delay = 150) {
  window.clearTimeout(stillTimer);
  stillTimer = window.setTimeout(() => {
    if (!touching && !wrapping.value) still.value = true;
  }, delay);
}

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
  moving();
  wrapping.value = true;
  wrapShift = forward ? 1 : -1;
  moved.style.order = forward ? "1" : "-1";
  // The other cards shift by one page; keep the card on screen where it is.
  trackEl.scrollLeft = forward ? (count - 2) * width : width;
  glide(trackEl, forward ? (count - 1) * width : 0, forward ? 1 : -1, () => {
    moved.style.order = "";
    trackEl.scrollLeft = target * trackEl.clientWidth;
  });
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
  if (!trackEl || props.hold || props.count < 2 || event.touches.length !== 1 || wrapping.value) {
    touch = null;
    return;
  }
  touching = true;
  // The track is held still while a finger is on it, but the other pages show only once it scrolls (onScroll). Showing
  // them on touchstart is content appearing under a tap, which iOS Safari reads as a hover: it drops that tap's click,
  // so every button on a page needed two taps.
  window.clearTimeout(stillTimer);
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
  touching = false;
  rest();
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
  touching = false;
  rest();
}

function onScroll() {
  const trackEl = track.value;
  if (!trackEl || trackEl.clientWidth < 1) return;
  const position = trackEl.scrollLeft / trackEl.clientWidth;
  if (wrapping.value) {
    emit("progress", position + wrapShift);
    if (Math.abs(trackEl.scrollLeft - wrapDest) < 1) settleWrap?.();
    return;
  }
  emit("progress", position);
  moving();
  rest();
  const next = Math.round(position);
  if (next !== index.value && next >= 0 && next < props.count) {
    index.value = next;
    remember();
  }
}

function onKey(event: KeyboardEvent) {
  if (props.hold) return;
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

/** With `hideOffscreen`, every page but the one in view is hidden while the track is still. */
function markOffscreen() {
  const trackEl = track.value;
  if (!trackEl) return;
  const hide = props.hideOffscreen && still.value;
  Array.from(trackEl.children).forEach((page, at) => {
    const away = props.hideOffscreen && at !== index.value;
    // Inert from the moment a turn starts: the page being left still shows while it slides, but can't be tapped or read.
    page.toggleAttribute("inert", away);
    page.toggleAttribute("data-offscreen", hide && away);
  });
}
watch([index, still, () => props.hideOffscreen, () => props.count], markOffscreen, { flush: "post" });

let observer: ResizeObserver | null = null;
onMounted(() => {
  reduce.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  index.value = storedIndex();
  emit("change", index.value);
  void measure().then(() => { go(index.value, "auto"); markOffscreen(); });
  observer = new ResizeObserver(() => { void measure(); });
  if (root.value) observer.observe(root.value);
  window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  settleWrap?.();
  window.clearTimeout(stillTimer);
  observer?.disconnect();
  window.removeEventListener("resize", measure);
});
watch(() => [props.count, props.lockIndex, props.height], () => { void measure(); });

defineExpose({ go, step, turn, index });
</script>

<template>
  <div ref="root" class="panels" :class="{ tight }">
    <div ref="track" class="track" :class="{ fixed: height != null, wrapping, held: hold }" :style="trackStyle" tabindex="0" :aria-label="label" @keydown="onKey" @scroll.passive="onScroll" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend.passive="onTouchEnd" @touchcancel.passive="onTouchCancel">
      <slot />
    </div>
    <div v-if="!hold && (count > 1 || settings)" class="strip" :class="{ halves: visualOnly && count > 1, cogged: settings }">
      <template v-if="count > 1">
      <button
        v-for="dot in count"
        :key="dot"
        type="button"
        class="dot"
        :class="{ on: index === dot - 1 }"
        :tabindex="unnamed ? -1 : 0"
        :aria-hidden="unnamed ? 'true' : undefined"
        :aria-label="unnamed ? undefined : (names?.[dot - 1] ?? `Panel ${dot} of ${count}`)"
        :aria-current="!unnamed && index === dot - 1 ? 'true' : undefined"
        @click="visualOnly ? undefined : turn(dot - 1)"
      ><span class="pip" /></button>
      <template v-if="visualOnly">
        <button type="button" class="half back" aria-label="Previous panel" @click="step(-1)" />
        <button type="button" class="half forward" aria-label="Next panel" @click="step(1)" />
      </template>
      </template>
      <button v-if="settings" type="button" class="cog" :aria-label="settings" data-card-pages @click="emit('settings')"><Icon name="cog" :size="18" /></button>
    </div>
    <template v-if="edges && !hold">
      <button type="button" class="edge left" aria-label="Previous panel" @click="step(-1)" />
      <button type="button" class="edge right" aria-label="Next panel" @click="step(1)" />
    </template>
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
.track.held { overflow-x: hidden; }
.track > :deep([data-offscreen]) { visibility: hidden; }
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
/* --cog-out: how far the cog's 44px box reaches past the strip, so the 18px gear's right edge
   meets the card's content edge, in line with the bars and buttons above it. */
.cogged { padding: 0 44px; --cog-out: 13px; }
.cogged .half.back { left: 0; width: calc(50% - 22px); }
.cogged .half.forward { right: calc(44px - var(--cog-out)); width: calc(50% - 22px + var(--cog-out)); }
.cog {
  position: absolute;
  right: calc(-1 * var(--cog-out));
  top: 0;
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
.can-hover .cog:hover, .cog:focus-visible { color: var(--text-primary); }
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
/* 12px of space, the 6px dots, 12px of space. The 44px hit box reaches 7px past each side. */
.tight .strip { height: 30px; }
.tight .dot { height: 44px; margin-top: -7px; margin-bottom: -7px; }
.tight .half, .tight .cog { top: -7px; height: 44px; bottom: auto; }
.tight .edge { bottom: 37px; }
@media (prefers-reduced-motion: reduce) {
  .track { scroll-behavior: auto; }
}
</style>
