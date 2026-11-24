<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

/** With large text the row scrolls; keep the current page's chip in view. */
const scroller = ref<HTMLElement | null>(null);
watch(() => props.current, (at) => {
  const box = scroller.value;
  const chip = box?.querySelectorAll<HTMLElement>(".chip")[at];
  if (!box || !chip || box.scrollWidth <= box.clientWidth) return;
  const left = chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2;
  box.scrollTo({ left, behavior: "smooth" });
}, { flush: "post" });
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
  display: grid; gap: var(--gap); overflow: hidden;
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
