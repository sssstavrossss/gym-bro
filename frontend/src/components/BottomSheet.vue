<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useDialogFocus } from "../lib/focusTrap";
import { keyboardInset } from "../lib/layout";
import { vp } from "../lib/viewport";

const props = defineProps<{ open: boolean; label: string; full?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement | null>(null);
const restoreFocus = useDialogFocus(() => props.open, root);
const dy = ref(0);
const dragging = ref(false);
const keyboard = ref(0);
let startY = 0;
let lastY = 0;
let lastT = 0;
let v = 0;

function syncKeyboard() {
  const viewport = window.visualViewport;
  keyboard.value = viewport ? keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
}

onMounted(() => {
  syncKeyboard();
  window.visualViewport?.addEventListener("resize", syncKeyboard);
  window.visualViewport?.addEventListener("scroll", syncKeyboard);
});
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener("resize", syncKeyboard);
  window.visualViewport?.removeEventListener("scroll", syncKeyboard);
});

function down(e: PointerEvent) {
  const t = e.target as HTMLElement;
  if (vp.desktop || t.closest("button, input, a")) return;
  dragging.value = true;
  startY = lastY = e.clientY;
  lastT = e.timeStamp;
  v = 0;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (!dragging.value) return;
  dy.value = Math.max(0, e.clientY - startY);
  const dt = e.timeStamp - lastT;
  if (dt > 0) v = (e.clientY - lastY) / dt;
  lastY = e.clientY;
  lastT = e.timeStamp;
}
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  if (dy.value > 120 || v > 0.6) emit("close");
  dy.value = 0;
}

const sheetStyle = computed(() => {
  const style: Record<string, string> = {};
  if (keyboard.value > 0) style["--keyboard"] = `${keyboard.value}px`;
  if (dy.value) style.transform = `translateY(${dy.value}px)`;
  return style;
});
</script>

<template>
  <Transition name="sheet" @after-leave="restoreFocus">
    <div v-if="open" ref="root" class="sheet-root" :class="{ panel: vp.desktop }" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1">
      <div class="scrim" @click="emit('close')" />
      <div class="sheet" :class="{ dragging, full: full && !vp.desktop }" :style="sheetStyle">
        <div class="drag-zone" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
          <div class="grabber-row"><div class="grabber" /></div>
          <slot name="header" />
        </div>
        <div class="sheet-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="sheet-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet-root { position: absolute; inset: 0; z-index: 30; overscroll-behavior: none; }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); transition: opacity .3s; }
.sheet {
  position: absolute; left: 0; right: 0;
  bottom: var(--keyboard, 0px);
  top: auto;
  max-height: calc(100dvh - var(--sat) - var(--keyboard, 0px) - 10px);
  background: var(--color-surface); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  padding: var(--space-gap) var(--space-screen) max(var(--sab), var(--space-screen));
  display: flex; flex-direction: column; gap: var(--space-gap);
  overflow: hidden; min-height: 0;
  transition: transform .3s cubic-bezier(.2, .8, .2, 1);
}
.sheet.dragging { transition: none; }
.drag-zone { display: flex; flex-direction: column; gap: 12px; touch-action: none; flex: none; }
.grabber-row { display: flex; justify-content: center; }
.grabber { width: 36px; height: 5px; border-radius: 3px; background: var(--color-track); }
.sheet-body {
  flex: 1 1 auto; min-height: 0;
  overflow-x: hidden; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
  display: flex; flex-direction: column; gap: 12px;
}
.sheet-foot {
  flex: none; display: flex; flex-direction: column; gap: 10px;
  padding-top: 10px; border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.is-tablet .sheet { left: max(16px, calc(50% - 300px)); right: max(16px, calc(50% - 300px)); }
.is-tablet .sheet:not(.full) {
  bottom: max(16px, var(--keyboard, 0px));
  border-radius: var(--radius-sheet);
  max-height: calc(100dvh - var(--sat) - 32px - var(--keyboard, 0px));
}
/* Food sheet matches the prototype: full height, not a short panel over Today. */
.sheet.full {
  top: calc(var(--sat) + 10px);
  bottom: var(--keyboard, 0px);
  max-height: calc(100dvh - var(--sat) - 10px - var(--keyboard, 0px));
}
.is-tablet .sheet.full {
  top: max(24px, calc(100dvh - 900px));
  bottom: max(16px, var(--keyboard, 0px));
}
.panel .scrim { background: rgba(0, 0, 0, 0.45); }
.panel .sheet {
  top: 12px; bottom: max(12px, var(--keyboard, 0px)); right: 12px; left: auto;
  width: 460px; max-height: calc(100dvh - 24px - var(--keyboard, 0px));
  border-radius: var(--radius-sheet); padding: 20px 24px 24px;
}
.panel .grabber-row { display: none; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .3s; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.sheet-enter-from .scrim, .sheet-leave-to .scrim { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
.sheet-enter-from.panel .sheet, .sheet-leave-to.panel .sheet { transform: translateX(24px); }
</style>
