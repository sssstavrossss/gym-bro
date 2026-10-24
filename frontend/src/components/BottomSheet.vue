<script setup lang="ts">
import { ref } from "vue";
import { vp } from "../lib/viewport";
defineProps<{ open: boolean; label: string }>();
const emit = defineEmits<{ close: [] }>();
const dy = ref(0);
const dragging = ref(false);
let startY = 0;
let lastY = 0;
let lastT = 0;
let v = 0;
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
</script>

<template>
  <Transition name="sheet">
    <div v-if="open" class="sheet-root" :class="{ panel: vp.desktop }" role="dialog" aria-modal="true" :aria-label="label">
      <div class="scrim" @click="emit('close')" />
      <div class="sheet" :class="{ dragging }" :style="dy ? { transform: `translateY(${dy}px)` } : undefined">
        <div class="drag-zone" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
          <div class="grabber-row"><div class="grabber" /></div>
          <slot name="header" />
        </div>
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet-root { position: absolute; inset: 0; z-index: 30; }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); transition: opacity .3s; }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0; top: auto; max-height: calc(100% - var(--sat) - 10px);
  background: var(--color-surface); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  padding: 8px 16px max(var(--sab), 16px);
  display: flex; flex-direction: column; gap: 12px; overflow: auto;
  transition: transform .3s cubic-bezier(.2, .8, .2, 1);
}
.sheet.dragging { transition: none; }
.drag-zone { display: flex; flex-direction: column; gap: 12px; touch-action: none; flex: none; }
.grabber-row { display: flex; justify-content: center; }
.grabber { width: 36px; height: 5px; border-radius: 3px; background: var(--color-track); }
.is-tablet .sheet { left: max(0px, calc(50% - 300px)); right: max(0px, calc(50% - 300px)); }
.panel .scrim { background: rgba(0, 0, 0, 0.45); }
.panel .sheet { top: 12px; bottom: 12px; right: 12px; left: auto; width: 460px; max-height: none; border-radius: var(--radius-sheet); padding: 20px 24px 24px; }
.panel .grabber-row { display: none; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .3s; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.sheet-enter-from .scrim, .sheet-leave-to .scrim { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
.sheet-enter-from.panel .sheet, .sheet-leave-to.panel .sheet { transform: translateX(24px); }
</style>
