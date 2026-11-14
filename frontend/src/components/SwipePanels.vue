<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  count: number;
  height?: number;
  lockIndex?: number;
  remember?: boolean;
  storageKey?: string;
  label?: string;
}>(), { remember: false, lockIndex: -1 });

const track = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
const index = ref(0);
const width = ref(0);
const locked = ref<number | null>(null);
const reduce = ref(false);

const visualOnly = computed(() => props.count * 44 > width.value && width.value > 0);
const trackStyle = computed(() => {
  const height = props.height ?? locked.value;
  return height ? { height: `${height}px` } : undefined;
});

function storedIndex(): number {
  if (!props.remember || !props.storageKey) return 0;
  const raw = Number(localStorage.getItem(props.storageKey));
  return Number.isInteger(raw) && raw >= 0 && raw < props.count ? raw : 0;
}

function remember() {
  if (!props.remember || !props.storageKey) return;
  localStorage.setItem(props.storageKey, String(index.value));
}

function go(next: number, behavior?: ScrollBehavior) {
  const trackEl = track.value;
  if (!trackEl || props.count < 1) return;
  const clamped = Math.max(0, Math.min(props.count - 1, next));
  index.value = clamped;
  remember();
  const motion = behavior ?? (reduce.value ? "auto" : "smooth");
  trackEl.scrollTo({ left: clamped * trackEl.clientWidth, behavior: motion });
}

function onScroll() {
  const trackEl = track.value;
  if (!trackEl || trackEl.clientWidth < 1) return;
  const next = Math.round(trackEl.scrollLeft / trackEl.clientWidth);
  if (next !== index.value && next >= 0 && next < props.count) {
    index.value = next;
    remember();
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    go(index.value + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    go(index.value - 1);
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
  void measure().then(() => go(index.value, "auto"));
  observer = new ResizeObserver(() => { void measure(); });
  if (root.value) observer.observe(root.value);
  window.addEventListener("resize", measure);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measure);
});
watch(() => [props.count, props.lockIndex, props.height], () => { void measure(); });

defineExpose({ go, index });
</script>

<template>
  <div ref="root" class="panels">
    <div ref="track" class="track" :style="trackStyle" tabindex="0" :aria-label="label" @keydown="onKey" @scroll.passive="onScroll">
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
        :aria-label="visualOnly ? undefined : `Panel ${dot} of ${count}`"
        :aria-current="!visualOnly && index === dot - 1 ? 'true' : undefined"
        @click="visualOnly ? undefined : go(dot - 1)"
      ><span class="pip" /></button>
      <template v-if="visualOnly">
        <button type="button" class="half back" aria-label="Previous panel" @click="go(index - 1)" />
        <button type="button" class="half forward" aria-label="Next panel" @click="go(index + 1)" />
      </template>
    </div>
    <button type="button" class="edge left" aria-label="Previous panel" @click="go(index - 1)" />
    <button type="button" class="edge right" aria-label="Next panel" @click="go(index + 1)" />
  </div>
</template>

<style scoped>
.panels { position: relative; min-width: 0; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.track:focus { outline: none; }
.track:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: -2px; }
.track {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  min-width: 0;
}
.track::-webkit-scrollbar { display: none; }
.track > :deep(*) {
  flex: 0 0 100%;
  height: 100%;
  scroll-snap-align: start;
  scroll-snap-stop: always;
  min-width: 0;
  overflow: auto;
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
.pip { width: 6px; height: 6px; border-radius: 99px; background: currentColor; transition: width 160ms ease; }
.dot.on { color: var(--text); }
.dot.on .pip { width: 16px; }
@media (prefers-reduced-motion: reduce) {
  .pip { transition: none; }
}
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
@media (prefers-reduced-motion: reduce) {
  .track { scroll-behavior: auto; }
}
</style>
