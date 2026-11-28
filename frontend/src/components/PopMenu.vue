<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import Icon from "./Icon.vue";

// A small menu that floats over the page from the thing tapped (README, *Logging a workout*; DESIGN.md): the
// workout timeline's +, an exercise's photo, a held set. It opens under its anchor, or over it when there's no room
// below, or slides up until it fits; a tap outside or Esc closes it and focus goes back to the anchor.
export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  /** Shown at the end of the row, quieter: "2:00". */
  value?: string;
  /** Last in its list, set apart by a line: Remove, Delete. */
  apart?: boolean;
  disabled?: boolean;
  /** Gets the menu's anchor, for a number wheel that opens from it once the menu has closed. */
  run: (anchor: Element) => void;
}
export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

const props = defineProps<{ anchor: Element | null; label: string; sections: MenuSection[] }>();
const emit = defineEmits<{ close: [] }>();

const el = ref<HTMLElement | null>(null);
const style = ref<Record<string, string>>({});
let openedAt = 0;

const PAD = 16;
const GAP = 2;
async function place(anchor: Element) {
  const box = anchor.getBoundingClientRect();
  const width = Math.min(248, window.innerWidth - 2 * PAD);
  const left = Math.min(Math.max(PAD, box.left + 6), window.innerWidth - PAD - width);
  // Drawn out of sight first, then placed by its real height.
  style.value = { left: `${left}px`, width: `${width}px`, top: "0px", visibility: "hidden", maxHeight: `${window.innerHeight - 2 * PAD}px` };
  await nextTick();
  const menu = el.value;
  if (!menu) return;
  const h = menu.offsetHeight;
  const vh = window.innerHeight;
  const top = box.bottom + GAP + h <= vh - PAD ? box.bottom + GAP : box.top - GAP - h >= PAD ? box.top - GAP - h : Math.max(PAD, vh - PAD - h);
  style.value = { ...style.value, top: `${top}px`, visibility: "visible" };
  menu.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    // The menu's own: the sheet under it stays open.
    event.stopPropagation();
    event.preventDefault();
    close();
    return;
  }
  // Tab leaves a menu, as it does any menu; the sheet under it keeps Tab from there.
  if (event.key === "Tab") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...(el.value?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
  if (!items.length) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
  items[next].focus();
}

/**
 * A long press opens the menu while the finger is still down, on the scrim. iOS then counts the same press as a
 * text-selection hold and selects the whole sheet behind it, so nothing on the page starts a selection while it's open.
 */
function noSelect(event: Event) {
  event.preventDefault();
}
function clearSelection() {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) selection.removeAllRanges();
}
function listen(on: boolean) {
  if (on) {
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("selectstart", noSelect, true);
    document.addEventListener("selectionchange", clearSelection);
  } else {
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("selectstart", noSelect, true);
    document.removeEventListener("selectionchange", clearSelection);
  }
}

watch(() => props.anchor, (anchor) => {
  listen(false);
  if (!anchor) return;
  openedAt = Date.now();
  clearSelection();
  listen(true);
  void place(anchor);
}, { immediate: true });
onBeforeUnmount(() => listen(false));

function close() {
  const anchor = props.anchor;
  emit("close");
  if (anchor instanceof HTMLElement) anchor.focus({ preventScroll: true });
}
/** A tap outside closes it, but not the lift of the finger that opened it with a long press. */
function outside() {
  if (Date.now() - openedAt > 350) close();
}
function pick(item: MenuItem) {
  const anchor = props.anchor;
  emit("close");
  if (anchor) item.run(anchor);
}
</script>

<template>
  <Teleport to="body">
    <template v-if="anchor">
      <div class="scrim" aria-hidden="true" data-menu-scrim @click="outside" @contextmenu.prevent />
      <div ref="el" class="menu" role="menu" :aria-label="label" :style="style" data-menu>
        <slot name="head" />
        <template v-for="(section, i) in sections" :key="i">
          <div v-if="section.title" class="t-capn c2 title" :class="{ split: i > 0 || $slots.head }">{{ section.title }}</div>
          <button
            v-for="item in section.items" :key="item.id" type="button" role="menuitem" class="item t-label" :class="{ apart: item.apart }"
            :disabled="item.disabled" :data-menu-item="item.id" @click="pick(item)"
          >
            <Icon :name="item.icon" :size="16" />
            <span class="grow label">{{ item.label }}</span>
            <span v-if="item.value" class="c2 tnum">{{ item.value }}</span>
          </button>
        </template>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: var(--z-menu); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.menu {
  position: fixed; z-index: var(--z-menu); box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-xs);
  display: flex; flex-direction: column; background: var(--color-surface); border-radius: var(--radius-l); box-shadow: var(--d-float);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; animation: pop .14s ease-out;
}
@keyframes pop { from { opacity: 0; transform: scale(.96); } }
@media (prefers-reduced-motion: reduce) { .menu { animation: none; } }
.title { padding: var(--space-s) var(--space-s) var(--space-2xs); }
.title.split { border-top: 1px solid var(--color-border); margin-top: var(--space-xs); }
/* A menu's rows are its one exception to 44px: a list edge to edge, 40px each (DESIGN.md). */
.item {
  display: flex; align-items: center; gap: var(--space-s); min-height: var(--control-menu-row); min-width: 0; padding: 0 var(--space-s);
  border: 0; border-radius: var(--radius-m); background: none; color: var(--text-primary); text-align: left;
}
.item:active, .item:focus-visible { background: var(--color-surface-2); }
.item:disabled { opacity: .4; }
.item :deep(svg) { flex: none; color: var(--text-secondary); }
.label { min-width: 0; overflow-wrap: anywhere; }
.item.apart { margin-top: var(--space-2xs); border-top: 1px solid var(--color-border); border-radius: 0 0 var(--radius-m) var(--radius-m); }
.tnum { font-variant-numeric: tabular-nums; }
</style>
