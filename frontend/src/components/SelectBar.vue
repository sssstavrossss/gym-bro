<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { toggleGroup } from "../lib/selection";
import { vp } from "../lib/viewport";
import { findEntry, removeEntries, viewed, type LogEntry } from "../state/log";
import { canSaveGroup } from "../lib/groups";
import { canSaveRecipe, recipeFoodEntries } from "../lib/recipes";
import { endSelect, openCopy, openGroupSheet, openRecipeFromEntries, ui } from "../ui";

const entries = computed(() => ui.selected.map((id) => findEntry(id)).filter((entry): entry is LogEntry => entry !== null));
const kcal = computed(() => entries.value.reduce((sum, entry) => sum + entry.kcal, 0));
const dayIds = computed(() => viewed.entries.map((entry) => entry.id));
const allSelected = computed(() => dayIds.value.length > 0 && dayIds.value.every((id) => ui.selected.includes(id)));
const canGroup = computed(() => canSaveGroup(entries.value.length));
const recipeCount = computed(() => recipeFoodEntries(entries.value).length);
const canRecipe = computed(() => canSaveRecipe(recipeCount.value));

function toggleAll() {
  ui.selected = toggleGroup(ui.selected, dayIds.value);
  if (!ui.selected.length) endSelect();
}
async function del() {
  const list = entries.value;
  if (!list.length) return;
  const removed = await removeEntries(list);
  if (removed) endSelect();
}
</script>

<template>
  <div class="sbar" :class="{ inset: vp.desktop }" role="toolbar" aria-label="Selected entries">
    <div class="top row">
      <button type="button" class="t-bodys link" @click="endSelect">Cancel</button>
      <span class="grow cnt t-bodys" aria-live="polite">{{ entries.length ? `${entries.length} selected · ${int(kcal)} kcal` : "Select entries" }}</span>
      <button type="button" class="t-bodys link" @click="toggleAll">{{ allSelected ? "Deselect all" : "Select all" }}</button>
    </div>
    <div class="acts row">
      <button type="button" class="act" :disabled="!entries.length" @click="openCopy()">
        <Icon name="copy" :size="20" /><span class="t-capn">Copy to…</span>
      </button>
      <button type="button" class="act" :disabled="!canGroup" :title="canGroup ? undefined : 'Select 2 or more'" @click="openGroupSheet(entries.map((entry) => entry.id), null)">
        <Icon name="layers" :size="20" /><span class="t-capn">Save as group</span>
      </button>
      <button type="button" class="act" :disabled="!canRecipe" :title="canRecipe ? undefined : 'Select 2 or more foods'" @click="openRecipeFromEntries(entries.map((entry) => entry.id), 'select')">
        <Icon name="food" :size="20" /><span class="t-capn">Save as recipe</span>
      </button>
      <button type="button" class="act" :disabled="!entries.length" @click="del">
        <Icon name="trash" :size="20" /><span class="t-capn">Delete</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sbar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 22;
  background: var(--color-surface); border-top: 1px solid var(--color-border);
  padding: var(--space-gap) max(var(--space-screen), calc(50% - 300px)) max(var(--sab), var(--space-gap));
  display: flex; flex-direction: column; gap: var(--space-gap);
}
.inset { left: 240px; }
.top { gap: 8px; min-height: 44px; }
.cnt { text-align: center; }
.link { color: var(--text-primary); min-height: 44px; padding: 6px 8px; }
.acts { justify-content: space-around; }
.act {
  flex: 1 1 0; min-width: 44px; max-width: 120px; min-height: 64px; padding: 4px 4px; border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  color: var(--text-primary);
}
.act .t-capn { text-align: center; }
.act:disabled { opacity: .35; cursor: default; }
.can-hover .act:not(:disabled):hover { background: var(--color-surface-2); }
.can-hover .link:hover { background: var(--color-surface-2); border-radius: 10px; }
</style>
