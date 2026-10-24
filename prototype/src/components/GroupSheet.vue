<script setup lang="ts">
// Name and save a group of foods logged together (from the food-sheet session or from Select mode).
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import { int } from "../lib/format";
import { keyboardEntry } from "../lib/viewport";
import { amountOf, saveGroup } from "../store";
import { endSelect, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "group");
const name = ref("");
const input = ref<HTMLInputElement | null>(null);
const kcal = computed(() => ui.groupDraft.reduce((a, e) => a + e.kcal, 0));
watch(open, (o) => {
  if (!o) return;
  name.value = "";
  if (keyboardEntry.value) nextTick(() => input.value?.focus());
});
function close() { ui.sheet = ui.groupReturn; ui.groupReturn = null; }
function save() {
  const g = saveGroup(name.value, ui.groupDraft);
  toast(`Saved “${g.name}” · ${g.items.length} items. Find it under Add food → Saved groups.`);
  if (ui.groupReturn !== "food") endSelect();
  close();
}
</script>

<template>
  <BottomSheet :open="open" label="Save as group" compact @close="close">
    <template #header>
      <div class="row hdr"><h2 class="t-head grow">Save as group</h2><CircleBtn icon="x" label="Close" @click="close" /></div>
    </template>
    <label class="field row">
      <input ref="input" v-model="name" class="t-body grow" type="text" placeholder="Name, e.g. Usual breakfast" maxlength="40" autocomplete="off" enterkeyhint="done" @keydown.enter.prevent="save" />
    </label>
    <p class="t-label c2 note">Re-add all {{ ui.groupDraft.length }} foods in one tap from Add food. Amounts are saved; the time is whenever you add it.</p>
    <div class="items col">
      <div v-for="e in ui.groupDraft" :key="e.id" class="row it">
        <span class="t-body grow ell">{{ e.name }}</span>
        <span class="t-label c3">{{ amountOf(e) ? amountOf(e) + " · " : "" }}{{ e.kcal }} kcal</span>
      </div>
    </div>
    <button type="button" class="primary-btn t-bodys" @click="save">Save group · {{ ui.groupDraft.length }} items · {{ int(kcal) }} kcal</button>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; }
.field { min-height: 44px; padding: 0 12px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; padding: 0; }
.field input::placeholder { color: var(--text-tertiary); }
.note { margin: 0; }
.items { gap: 0; overflow-y: auto; min-height: 0; flex: 0 1 auto; }
.it { min-height: 40px; gap: 8px; border-bottom: 1px solid var(--color-border); }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
