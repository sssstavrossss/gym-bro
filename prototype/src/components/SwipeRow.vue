<script setup lang="ts">
// Food row with real swipe-left actions (Copy / Delete). Pointer events + touch-action: pan-y,
// so vertical scrolling still belongs to the browser (iOS Safari) and horizontal drags move the row.
import { ref, watch } from "vue";
import Icon from "./Icon.vue";
import { openRowId } from "./swipeState";

const props = withDefaults(defineProps<{ id: string; swipe?: boolean }>(), { swipe: true });
const emit = defineEmits<{ copy: []; delete: []; tap: [MouseEvent] }>();
const W = 144;
const x = ref(0);
const dragging = ref(false);
let sx = 0, sy = 0, base = 0, mode: "none" | "h" | "v" = "none", moved = false;

watch(openRowId, (id) => { if (id !== props.id && !dragging.value) x.value = 0; });
watch(() => props.swipe, (v) => { if (!v) x.value = 0; });

function down(e: PointerEvent) {
  if (!props.swipe || (e.pointerType === "mouse" && e.button !== 0)) return;
  sx = e.clientX; sy = e.clientY; base = x.value; mode = "none"; moved = false;
  dragging.value = true;
}
function move(e: PointerEvent) {
  if (!dragging.value) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (mode === "none") {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      mode = "h"; moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      openRowId.value = props.id;
    } else if (Math.abs(dy) > 8) { mode = "v"; }
  }
  if (mode !== "h") return;
  let nx = base + dx;
  if (nx > 0) nx = nx / 4; // rubber band
  if (nx < -W) nx = -W + (nx + W) / 4;
  x.value = nx;
}
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  if (mode === "h") {
    x.value = x.value < -W / 2.5 ? -W : 0;
    if (x.value === 0 && openRowId.value === props.id) openRowId.value = null;
  }
  mode = "none";
}
function click(e: MouseEvent) {
  if (moved) { moved = false; return; }
  if (x.value !== 0) { x.value = 0; openRowId.value = null; return; }
  if (openRowId.value) { openRowId.value = null; return; }
  emit("tap", e);
}
function act(kind: "copy" | "delete") {
  x.value = 0; openRowId.value = null;
  if (kind === "copy") emit("copy"); else emit("delete");
}
</script>

<template>
  <div class="swipe">
    <div class="actions" :style="{ opacity: x < 0 ? 1 : 0 }">
      <button type="button" class="act copy" @click="act('copy')"><Icon name="copy" :size="16" /><span class="t-capn">Copy to…</span></button>
      <button type="button" class="act del" @click="act('delete')"><Icon name="trash" :size="16" /><span class="t-capn">Delete</span></button>
    </div>
    <div class="fg" :class="{ dragging }" :style="{ transform: `translate3d(${x}px,0,0)` }"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @click="click">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.swipe { position: relative; overflow: hidden; background: var(--color-surface-2); }
.actions { position: absolute; top: 0; right: 0; bottom: 0; display: flex; }
.act { width: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #fff; }
.act.copy { background: var(--color-surface-2); }
.act.del { background: var(--shade-off); }
.fg { position: relative; background: var(--row-bg, var(--color-bg)); touch-action: pan-y; user-select: none; -webkit-user-select: none; transition: transform .22s cubic-bezier(.2,.8,.2,1); }
.fg.dragging { transition: none; }
</style>
