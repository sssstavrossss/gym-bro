<script setup lang="ts">
// Small "i" button with a popover (item 0). A real button: works with touch, mouse and keyboard;
// 44 px hit area around an 18 px glyph; Escape or a tap elsewhere closes it.
import { onBeforeUnmount, onMounted, ref, useId } from "vue";
const props = withDefaults(defineProps<{ label: string; align?: "left" | "right" }>(), { align: "left" });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const id = useId();
function away(e: Event) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false; }
function key(e: KeyboardEvent) { if (e.key === "Escape" && open.value) { open.value = false; e.stopPropagation(); } }
onMounted(() => { document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key, true); });
onBeforeUnmount(() => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key, true); });
void props;
</script>

<template>
  <span ref="root" class="itip">
    <button type="button" class="ibtn" :aria-label="label" :aria-expanded="open" :aria-controls="id" @click.stop="open = !open">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M9 8v5M9 5.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
    </button>
    <span v-show="open" :id="id" class="pop t-capn" :class="align" role="note" @click.stop><slot /></span>
  </span>
</template>

<style scoped>
.itip { position: relative; display: inline-flex; z-index: 3; }
.ibtn { position: relative; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary); border-radius: 12px; margin: -4px 0; }
.ibtn::after { content: ""; position: absolute; inset: -10px; } /* 44 px target */
.ibtn:hover, .ibtn[aria-expanded="true"] { color: var(--text-primary); }
.pop { position: absolute; top: calc(100% + 8px); width: min(264px, 80vw); padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--text-primary); box-shadow: 0 8px 24px rgba(0,0,0,.5); line-height: 1.45; text-align: left; white-space: normal; font-weight: 400; text-transform: none; letter-spacing: 0; }
.pop.left { left: -8px; }
.pop.right { right: -8px; }
</style>
