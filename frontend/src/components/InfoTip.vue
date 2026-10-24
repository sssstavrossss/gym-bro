<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from "vue";

defineProps<{ label: string }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const id = useId();

function away(event: Event) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    open.value = false;
    event.stopPropagation();
  }
}
onMounted(() => {
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", key, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", away, true);
  document.removeEventListener("keydown", key, true);
});
</script>

<template>
  <span ref="root" class="itip">
    <button type="button" class="ibtn" :aria-label="label" :aria-expanded="open" :aria-controls="id" @click.stop="open = !open">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M9 8v5M9 5.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </button>
    <span v-if="open" :id="id" class="pop t-capn" role="note"><slot /></span>
  </span>
</template>

<style scoped>
.itip { position: relative; display: inline-flex; z-index: 3; }
.ibtn {
  position: relative; width: 44px; height: 44px; margin: -28px -4px -2px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-secondary); border-radius: 22px;
}
.ibtn:hover, .ibtn[aria-expanded="true"] { color: var(--text-primary); }
.dt-xl .ibtn { margin: 0; flex: none; }
.pop {
  position: absolute; top: calc(100% + 4px); left: -8px; width: min(264px, 80vw);
  padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2);
  border: 1px solid var(--color-border); color: var(--text-primary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .5); line-height: 1.45; text-align: left;
  white-space: normal; font-weight: 400; text-transform: none; letter-spacing: 0;
}
</style>
