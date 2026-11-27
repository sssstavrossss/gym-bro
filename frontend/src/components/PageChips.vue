<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { pillCover, pillSpots } from "../lib/foodPages";

/**
 * Chips that name the pages of a SwipePanels below them. They share the row equally, so a count
 * changing never moves them. The highlight is one pill that follows the swipe from chip to chip;
 * across a wrap it slides off one end and back in at the other.
 */
const props = defineProps<{
  pages: { label: string; count?: number }[];
  /** The page showing. */
  current: number;
  /** The pager's position while it moves (SwipePanels `progress`); the pill sits on `current` without one. */
  position: number | null;
  label: string;
}>();
const emit = defineEmits<{ pick: [index: number] }>();

const spots = computed(() => pillSpots(props.position ?? props.current, props.pages.length));
/** How much of each chip the pill covers, 0 to 1, so its label turns to the pill's ink as the pill slides under it. */
const covers = computed(() => props.pages.map((_, at) => pillCover(spots.value, at)));

/**
 * When the chips run past the edge (Exercises' seven muscle groups, or large text), the row follows the pager's
 * position as it moves, so the pill's chip is always the one in the middle and it never slides off out of view. It
 * is set frame by frame with the swipe rather than with a smooth scroll of its own: a second smooth scroll starting
 * while the pages glide to their snap point is what made a swipe come to rest a little off on iOS.
 */
const scroller = ref<HTMLElement | null>(null);
/** The row's scroll that centres chip `at` (clamped to the row's ends). */
function leftFor(box: HTMLElement, at: number): number {
  const chip = box.querySelectorAll<HTMLElement>(".chip")[at];
  if (!chip) return box.scrollLeft;
  const offset = chip.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
  return Math.max(0, Math.min(box.scrollWidth - box.clientWidth, offset - (box.clientWidth - chip.offsetWidth) / 2));
}
function follow() {
  const box = scroller.value;
  const count = props.pages.length;
  if (!box || count < 1 || box.scrollWidth <= box.clientWidth + 1) return;
  const at = props.position ?? props.current;
  // Across a wrap the position runs past an end (to -1 or `count`): the row sweeps back to the other end meanwhile.
  const from = Math.max(0, Math.min(count - 1, Math.floor(at)));
  const to = at >= count - 1 ? (at > count - 1 ? 0 : count - 1) : at < 0 ? count - 1 : Math.min(count - 1, from + 1);
  const t = at > count - 1 ? at - (count - 1) : at < 0 ? -at : at - Math.floor(at);
  const left = leftFor(box, at < 0 ? 0 : from);
  const target = t > 0 ? left + (leftFor(box, to) - left) * t : left;
  if (Math.abs(box.scrollLeft - target) >= 0.5) box.scrollLeft = target;
}
watch(() => [props.position, props.current] as const, follow, { flush: "post" });
let resize: ResizeObserver | null = null;
onMounted(() => {
  follow();
  if (scroller.value && "ResizeObserver" in window) {
    resize = new ResizeObserver(() => follow());
    resize.observe(scroller.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
</script>

<template>
  <!-- The outer box scrolls sideways when large text needs more room than the row has; the inner grid clips the pill as it wraps. -->
  <div ref="scroller" class="pchips" role="group" :aria-label="label" :style="{ '--n': pages.length }">
    <div class="prow">
      <span v-for="(page, at) in pages" :key="`f${page.label}`" class="face" aria-hidden="true" :style="{ gridColumn: at + 1 }" />
      <span v-for="(spot, at) in spots" :key="`p${at}`" class="pill" aria-hidden="true" :style="{ '--at': spot }" />
      <button
        v-for="(page, at) in pages"
        :key="page.label"
        type="button"
        class="chip t-label"
        :class="{ on: at === current }"
        :style="{ gridColumn: at + 1, '--cover': covers[at] }"
        :aria-pressed="at === current"
        @click="emit('pick', at)"
      >
        <span class="ell">{{ page.label }}</span><span v-if="page.count != null" class="n">{{ page.count }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pchips {
  flex: none; container-type: inline-size;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain;
}
.pchips::-webkit-scrollbar { display: none; }
/*
 * Faces, the sliding pill and the chips share one grid row, so all three grow with the text. The columns
 * are equal, a share of the row, but never narrower than a label at its text size: with large text the
 * row runs past the edge and scrolls instead of wrapping or overlapping.
 */
.prow {
  --gap: var(--space-xs);
  --face-inset: calc((var(--control-hit) - var(--control-chip)) / 2);
  /* As wide as its columns, so chips past the edge make the outer box scroll rather than being clipped here. */
  display: grid; gap: var(--gap); overflow: hidden; width: max-content; min-width: 100%;
  grid-template-columns: repeat(var(--n), max(var(--chip-min), calc((100cqi - (var(--n) - 1) * var(--gap)) / var(--n))));
  /* About "My foods 1" at the label size (.t-label), so it grows with the text and never sets the width at the usual size. */
  --chip-min: calc(0.7647rem * 5.2 + 2 * var(--space-s));
}
.face, .pill { grid-row: 1; margin: var(--face-inset) 0; border-radius: var(--radius-pill); pointer-events: none; }
.face { background: var(--btn-bg, var(--color-surface-2)); box-shadow: var(--d-control); }
.pill {
  grid-column: 1;
  /* --at is in chips; each chip is the pill's own width plus the gap. */
  transform: translateX(calc(var(--at) * (100% + var(--gap))));
  background: var(--color-action); box-shadow: var(--d-action);
}
.chip, .chip.on {
  grid-row: 1; min-width: 0; padding-left: var(--space-s); padding-right: var(--space-s); white-space: nowrap;
  color: color-mix(in srgb, var(--color-on-action) calc(var(--cover, 0) * 100%), var(--text-secondary));
}
.chip::before, .chip.on::before { background: transparent; }
.ell { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.n { flex: none; color: color-mix(in srgb, var(--color-on-action) calc(var(--cover, 0) * 65%), var(--text-tertiary)); }
.can-hover .chip:not(.on):hover::before { background: transparent; }
</style>
