<script setup lang="ts">
// Touch: drag the row left to reveal Copy to… and Delete. A pointer uses hover actions instead.
import { ref, watch } from "vue";
import Icon from "./Icon.vue";
import { settledSwipe } from "../lib/selection";
import { openRowId } from "./swipeState";

const props = withDefaults(defineProps<{ id: string; swipe?: boolean; copyLabel: string; deleteLabel: string }>(), { swipe: true });
const emit = defineEmits<{ copy: []; delete: [] }>();
const width = 144;
const x = ref(0);
const dragging = ref(false);
let sx = 0;
let sy = 0;
let base = 0;
let mode: "none" | "h" | "v" = "none";
let moved = false;

watch(openRowId, (id) => {
  if (id !== props.id && !dragging.value) x.value = 0;
});
watch(() => props.swipe, (value) => {
  if (!value) x.value = 0;
});

function down(event: PointerEvent) {
  if (!props.swipe || (event.pointerType === "mouse" && event.button !== 0)) return;
  if ((event.target as HTMLElement).closest("button.act")) return;
  sx = event.clientX;
  sy = event.clientY;
  base = x.value;
  mode = "none";
  moved = false;
  dragging.value = true;
}
function move(event: PointerEvent) {
  if (!dragging.value) return;
  const dx = event.clientX - sx;
  const dy = event.clientY - sy;
  if (mode === "none") {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      mode = "h";
      moved = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      openRowId.value = props.id;
    } else if (Math.abs(dy) > 8) {
      mode = "v";
    }
  }
  if (mode !== "h") return;
  let next = base + dx;
  if (next > 0) next /= 4;
  if (next < -width) next = -width + (next + width) / 4;
  x.value = next;
}
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  if (mode === "h") {
    x.value = settledSwipe(x.value, width);
    if (x.value === 0 && openRowId.value === props.id) openRowId.value = null;
  }
  mode = "none";
}
function swallow(event: MouseEvent) {
  if (moved) {
    moved = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (x.value !== 0) {
    x.value = 0;
    if (openRowId.value === props.id) openRowId.value = null;
    event.preventDefault();
    event.stopPropagation();
  }
}
function act(kind: "copy" | "delete") {
  x.value = 0;
  openRowId.value = null;
  if (kind === "copy") emit("copy");
  else emit("delete");
}
</script>

<template>
  <div class="swipe">
    <div v-if="swipe" class="actions" :style="{ opacity: x < 0 ? 1 : 0 }">
      <button type="button" class="act copy" :aria-label="copyLabel" @click="act('copy')">
        <Icon name="copy" :size="16" /><span class="t-capn">Copy to…</span>
      </button>
      <button type="button" class="act del" :aria-label="deleteLabel" @click="act('delete')">
        <Icon name="trash" :size="16" /><span class="t-capn">Delete</span>
      </button>
    </div>
    <div
      class="fg"
      :class="{ dragging }"
      :style="{ transform: `translate3d(${x}px,0,0)` }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @click.capture="swallow"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.swipe { position: relative; overflow: hidden; min-width: 0; max-width: 100%; }
.actions { position: absolute; top: 0; right: 0; bottom: 0; display: flex; }
.act { width: 72px; min-height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--color-action); }
.act.copy { background: var(--color-surface-2); color: var(--text-primary); }
.act.del { background: var(--shade-off); }
.fg { position: relative; min-width: 0; max-width: 100%; background: var(--color-bg); touch-action: pan-y; transition: transform .22s cubic-bezier(.2, .8, .2, 1); }
.card .fg { background: var(--color-surface); }
.fg.dragging { transition: none; }
</style>
