// Phone <600, tablet 600–1023, desktop ≥1024, wide ≥1280.
import { computed, reactive } from "vue";

const QUERIES = {
  tablet: "(min-width: 600px)",
  desktop: "(min-width: 1024px)",
  wide: "(min-width: 1280px)",
  hover: "(hover: hover) and (pointer: fine)",
} as const;

export const vp = reactive({ tablet: false, desktop: false, wide: false, hover: false });

for (const [k, q] of Object.entries(QUERIES) as [keyof typeof QUERIES, string][]) {
  const m = window.matchMedia(q);
  vp[k] = m.matches;
  m.addEventListener("change", (e) => (vp[k] = e.matches));
}

export const keyboardEntry = computed(() => vp.hover);
export const cameraCapable = computed(() => !vp.hover && "mediaDevices" in navigator);
