<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { canSaveGroup, groupName, groupNameMax } from "../lib/groups";
import { keyboardEntry } from "../lib/viewport";
import { findEntry, type LogEntry } from "../state/log";
import { saveGroupFromEntries } from "../state/groups";
import { closeGroupSheet, finishGroupSave, toast, ui } from "../ui";

const open = computed(() => ui.sheet === "group");
const name = ref("");
const error = ref("");
const saving = ref(false);
const input = ref<HTMLInputElement | null>(null);
const list = computed(() => ui.groupEntryIds
  .map((id) => findEntry(id))
  .filter((entry): entry is LogEntry => entry !== null));
const kcal = computed(() => list.value.reduce((sum, entry) => sum + entry.kcal, 0));
const ready = computed(() => canSaveGroup(list.value.length));

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = "";
  error.value = "";
  if (keyboardEntry.value) nextTick(() => input.value?.focus());
});

function amountOf(entry: LogEntry): string {
  if (entry.unit && entry.amount) return `${entry.amount} ${entry.unit}`;
  return entry.grams ? `${entry.grams} g` : "";
}

async function save() {
  if (saving.value || !ready.value) return;
  saving.value = true;
  error.value = "";
  const named = groupName(name.value);
  const result = await saveGroupFromEntries(named, list.value.map((entry) => entry.id));
  saving.value = false;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  const count = result.group.items.length;
  toast(`Saved “${result.group.name}” · ${count} items. Find it under Add food → Saved groups.`);
  finishGroupSave();
}
</script>

<template>
  <BottomSheet :open="open" label="Save as group" @close="closeGroupSheet">
    <template #header>
      <div class="row hdr">
        <h2 class="t-head grow">Save as group</h2>
        <button type="button" class="cbtn" style="--s: 44px" aria-label="Close" @click="closeGroupSheet">
          <Icon name="x" :size="18" />
        </button>
      </div>
    </template>
    <label class="field row">
      <input
        ref="input"
        v-model="name"
        class="t-body grow"
        type="text"
        placeholder="Name, e.g. Usual breakfast"
        :maxlength="groupNameMax"
        autocomplete="off"
        enterkeyhint="done"
        aria-label="Group name"
        @keydown.enter.prevent="save"
      />
    </label>
    <p class="t-label c2 note">Re-add all {{ list.length }} foods in one tap from Add food. Amounts are saved; the time is whenever you add it.</p>
    <div class="items col">
      <div v-for="entry in list" :key="entry.id" class="row it">
        <span class="t-body grow ell">{{ entry.name }}</span>
        <span class="t-label c3">{{ amountOf(entry) ? amountOf(entry) + " · " : "" }}{{ int(entry.kcal) }} kcal</span>
      </div>
    </div>
    <p v-if="error" class="t-label err" role="alert">{{ error }}</p>
    <button type="button" class="primary-btn t-bodys" :disabled="saving || !ready" @click="save">
      {{ saving ? "Saving…" : `Save group · ${list.length} items · ${int(kcal)} kcal` }}
    </button>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; }
.field { min-height: 44px; padding: 0 12px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; width: 100%; padding: 0; }
.field input::placeholder { color: var(--text-tertiary); }
.note { margin: 0; }
.items { gap: 0; }
.it { min-height: 44px; gap: 8px; border-bottom: 1px solid var(--color-border); }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.err { margin: 0; }
</style>
