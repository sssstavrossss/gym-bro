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
const countLabel = computed(() => allSelected.value ? "Deselect all" : "Select all");

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
    <button type="button" class="hit x" aria-label="Cancel" @click="endSelect">
      <Icon name="x" :size="18" :sw="2.4" />
    </button>
    <button type="button" class="hit count" :aria-label="countLabel" @click="toggleAll">
      <span class="num">{{ entries.length }} · {{ int(kcal) }}</span>
    </button>
    <span class="grow" />
    <button type="button" class="hit act" :disabled="!entries.length" aria-label="Copy to…" @click="openCopy()">
      <Icon name="copy" :size="18" /><span class="cap">Copy</span>
    </button>
    <button type="button" class="hit act" :disabled="!canGroup" :title="canGroup ? 'Save as group' : 'Select 2 or more'" aria-label="Save as group" @click="openGroupSheet(entries.map((entry) => entry.id), null)">
      <Icon name="layers" :size="18" /><span class="cap">Group</span>
    </button>
    <button type="button" class="hit act" :disabled="!canRecipe" :title="canRecipe ? 'Save as recipe' : 'Select 2 or more foods'" aria-label="Save as recipe" @click="openRecipeFromEntries(entries.map((entry) => entry.id), 'select')">
      <Icon name="food" :size="18" /><span class="cap">Recipe</span>
    </button>
    <button type="button" class="hit act" :disabled="!entries.length" aria-label="Delete" @click="del">
      <Icon name="trash" :size="18" /><span class="cap">Delete</span>
    </button>
  </div>
</template>

<style scoped>
.sbar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 22; box-sizing: border-box;
  height: var(--tabbar-h); padding: 3px 4px 0;
  display: flex; align-items: flex-start; gap: 0;
  background: var(--color-bg); border-top: 1px solid var(--color-border);
  overflow: hidden;
}
.is-desktop .sbar { height: 50px; }
.inset { left: 240px; }
.grow { flex: 1 1 auto; min-width: 4px; height: 44px; }
.hit {
  flex: none; width: 44px; height: 44px; min-width: 44px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  color: var(--text-primary);
}
.x { color: var(--text-primary); }
.count { width: auto; max-width: 108px; padding: 0 4px; align-items: flex-start; }
.num { font-size: 13px; line-height: 16px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
.act { color: var(--text-secondary); }
.cap { font-size: 11px; line-height: 12px; font-weight: 500; white-space: nowrap; }
.hit:disabled { opacity: .35; cursor: default; }
.can-hover .hit:not(:disabled):hover { color: var(--text-primary); }
</style>
