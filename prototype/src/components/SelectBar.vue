<script setup lang="ts">
// Action bar for Select mode. Phone/tablet: replaces the tab bar. Desktop: floating bar over the content.
import { computed } from "vue";
import { useRoute } from "vue-router";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { vp } from "../lib/viewport";
import { entriesFor, removeEntries, restoreEntries, state, today, type Entry } from "../store";
import { endSelect, openCopy, openGroupSheet, toast, ui } from "../ui";

const route = useRoute();
const list = computed(() => ui.selected.map((id) => state.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e));
const kcal = computed(() => list.value.reduce((a, e) => a + e.kcal, 0));
const date = computed(() => list.value[0]?.date ?? ((route.params.date as string) || today));
const all = computed(() => entriesFor(date.value));
const allSel = computed(() => all.value.length > 0 && all.value.every((e) => ui.selected.includes(e.id)));
function toggleAll() { ui.selected = allSel.value ? [] : all.value.map((e) => e.id); }
function del() {
  const n = list.value.length;
  const removed = removeEntries(ui.selected.slice());
  endSelect();
  toast(`Deleted ${n} item${n > 1 ? "s" : ""}`, { label: "Undo", run: () => restoreEntries(removed) });
}
</script>

<template>
  <Transition name="sbar">
    <div v-if="ui.selecting" class="sbar" :class="{ float: vp.desktop }" role="toolbar" aria-label="Selected entries">
      <div class="top row">
        <button type="button" class="t-bodys link" @click="endSelect">Cancel</button>
        <span class="grow cnt t-bodys" aria-live="polite">{{ list.length ? `${list.length} selected · ${int(kcal)} kcal` : "Select entries" }}</span>
        <button type="button" class="t-bodys link" @click="toggleAll">{{ allSel ? "Deselect all" : "Select all" }}</button>
      </div>
      <div class="acts row">
        <button type="button" class="act" :disabled="!list.length" @click="openCopy()"><Icon name="copy" :size="20" /><span class="t-capn">Copy to…</span></button>
        <button type="button" class="act" :disabled="list.length < 2" :title="list.length < 2 ? 'Select 2 or more' : undefined" @click="openGroupSheet(list)"><Icon name="layers" :size="20" /><span class="t-capn">Save as group</span></button>
        <button type="button" class="act" :disabled="!list.length" @click="del"><Icon name="trash" :size="20" /><span class="t-capn">Delete</span></button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sbar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 22; background: var(--color-surface); border-top: 1px solid var(--color-border); padding: 8px max(16px, calc(50% - 300px)) max(var(--sab), 12px); display: flex; flex-direction: column; gap: 6px; }
.top { gap: 8px; min-height: 44px; }
.cnt { text-align: center; }
.link { color: var(--text-primary); padding: 6px 2px; }
.acts { justify-content: space-around; }
.act { min-width: 88px; height: 52px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--text-primary); }
.act:disabled { opacity: .35; cursor: default; }
.can-hover .act:not(:disabled):hover { background: var(--color-surface-2); }
/* desktop: one floating row — count · actions · Select all · Cancel */
.float { left: calc(120px + 50%); right: auto; transform: translateX(-50%); bottom: 24px; width: max-content; max-width: calc(100% - 300px); border: 1px solid var(--color-border); border-radius: 20px; padding: 8px 12px 8px 20px; flex-direction: row; align-items: center; gap: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.6); white-space: nowrap; }
.float .top { display: contents; }
.float .cnt { order: -2; text-align: left; flex: none; margin-right: 8px; }
.float .acts { order: -1; gap: 4px; }
.float .act { flex-direction: row; min-width: 0; min-height: 44px; padding: 0 12px; gap: 6px; }
.float .act .t-capn { font-size: 0.7647rem; }
.float .link { padding: 6px 10px; border-radius: 10px; }
.can-hover .float .link:hover { background: var(--color-surface-2); }
.sbar-enter-active, .sbar-leave-active { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .2s; }
.sbar-enter-from, .sbar-leave-to { transform: translateY(100%); opacity: 0; }
.float.sbar-enter-from, .float.sbar-leave-to { transform: translate(-50%, 30px); }
</style>
