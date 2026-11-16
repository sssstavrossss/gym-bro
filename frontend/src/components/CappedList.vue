<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { capHeight, scrollMark } from "../lib/scrollCap";

/**
 * A list that shows `maxRows` rows and scrolls the rest inside itself, with a thin scroll bar
 * in the card's right padding and fades on the edges that hide rows. With fewer rows it is a
 * plain list. The rows are the slot's direct children. Attributes (class, data-*) go on the
 * scrolling element, so a parent styles it with `:deep(.its-class)`.
 */
defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ maxRows?: number; tag?: string; watchKey?: unknown }>(), { maxRows: 0, tag: "div" });

const listEl = ref<HTMLElement | null>(null);
const capped = ref<number | null>(null);
const mark = ref(scrollMark(0, 0, 0));

function measure() {
  const el = listEl.value;
  if (!el || !props.maxRows) {
    capped.value = null;
    return;
  }
  const bottoms = [...el.children].map((child) => {
    const row = child as HTMLElement;
    return row.offsetTop + row.offsetHeight;
  });
  capped.value = capHeight(bottoms, props.maxRows);
  void nextTick(onScroll);
}
function onScroll() {
  const el = listEl.value;
  mark.value = el && capped.value != null ? scrollMark(el.scrollTop, el.scrollHeight, el.clientHeight) : scrollMark(0, 0, 0);
}

let resize: ResizeObserver | null = null;
let rows: MutationObserver | null = null;
onMounted(() => {
  if (!props.maxRows || !listEl.value) return;
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(() => measure());
    resize.observe(listEl.value);
  }
  // Rows added or removed change the cap even when the list's own size does not.
  if (typeof MutationObserver !== "undefined") {
    rows = new MutationObserver(() => measure());
    rows.observe(listEl.value, { childList: true });
  }
  measure();
});
onBeforeUnmount(() => {
  resize?.disconnect();
  rows?.disconnect();
});
watch(() => props.watchKey, () => { void nextTick(measure); });
</script>

<template>
  <div class="capwrap" :class="{ capped: capped != null, limit: maxRows > 0 }">
    <component
      :is="tag"
      ref="listEl"
      v-bind="$attrs"
      class="caplist"
      :style="capped != null ? { maxHeight: `${capped}px` } : undefined"
      @scroll.passive="onScroll"
    >
      <slot />
    </component>
    <template v-if="capped != null">
      <span v-show="mark.above" class="fade top" aria-hidden="true" data-more-above />
      <span v-show="mark.below" class="fade bottom" aria-hidden="true" data-more-below />
      <span class="sbar" aria-hidden="true" data-scroll-bar><i :style="{ top: `${mark.thumbTop}%`, height: `${mark.thumbHeight}%` }" /></span>
    </template>
  </div>
</template>

<style scoped>
.capwrap { position: relative; min-width: 0; }
.caplist { position: relative; min-width: 0; }
/* A capped list always clips sideways, so a swiped row never shows outside the card. */
.limit .caplist { overflow-x: hidden; }
/* Scrolls up and down; still clips sideways for swipe rows. At either end a swipe carries on to the page. */
.capped .caplist { overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: auto; scrollbar-width: none; }
.capped .caplist::-webkit-scrollbar { display: none; }
.fade { position: absolute; left: 0; right: 0; height: 40px; pointer-events: none; z-index: 2; }
.fade.top { top: 1px; background: linear-gradient(to top, transparent, var(--color-surface) 90%); }
.fade.bottom { bottom: 1px; height: 52px; background: linear-gradient(to bottom, transparent, var(--color-surface) 88%); }
/* In the card's right padding, so it never covers a number. */
.sbar { position: absolute; top: 6px; bottom: 6px; right: calc(var(--space-screen) / -2 - 1.5px); width: 3px; border-radius: 2px; background: var(--color-track); pointer-events: none; z-index: 3; }
.sbar i { position: absolute; left: 0; right: 0; border-radius: 2px; background: var(--text-tertiary); }
</style>
