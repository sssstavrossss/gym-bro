// Reactive breakpoints. Phone (<600) is the primary design; tablet 600–1023; desktop ≥1024; wide ≥1280.
import { computed, reactive } from "vue";

const QUERIES = {
  tablet: "(min-width: 600px)",
  desktop: "(min-width: 1024px)",
  wide: "(min-width: 1280px)",
  /** mouse/trackpad: hover buttons instead of swipe, real keyboard instead of the on-screen keypad */
  hover: "(hover: hover) and (pointer: fine)",
} as const;

export const vp = reactive({ tablet: false, desktop: false, wide: false, hover: false });

for (const [k, q] of Object.entries(QUERIES) as [keyof typeof QUERIES, string][]) {
  const m = window.matchMedia(q);
  vp[k] = m.matches;
  m.addEventListener("change", (e) => (vp[k] = e.matches));
}

/** Type numbers with the real keyboard (hide the numeric keypad). */
export const keyboardEntry = computed(() => vp.hover); // input device, not width (G44)
/** Camera / barcode features only make sense on a phone or tablet with a camera. */
export const cameraCapable = computed(() => !vp.hover && "mediaDevices" in navigator);
