<script setup lang="ts">
import { computed, onMounted } from "vue";
import CappedList from "./CappedList.vue";
import Icon from "./Icon.vue";
import LogRow from "./LogRow.vue";
import { byTime } from "../lib/dayLog";
import { dayMonth } from "../lib/dates";
import { int } from "../lib/format";
import { readdToast } from "../lib/groups";
import { activateMark, activateRow, type Selection } from "../lib/selection";
import { removeEntries, type LogEntry } from "../state/log";
import { loadGroups, readdSavedGroup, savedGroups } from "../state/groups";
import { deviceTimeZone } from "../state/profile";
import { endSelect, openCopy, openEdit, openFood, startSelect, toast, toastError, ui } from "../ui";

const props = defineProps<{ date: string; today: string; entries: LogEntry[]; compact?: boolean; showEmpty?: boolean; home?: boolean; maxRows?: number }>();
const rows = computed(() => byTime(props.entries));
const ordered = computed(() => rows.value.map((entry) => entry.id));
const isToday = computed(() => props.date === props.today);
const isLater = computed(() => props.date > props.today);

function selected(id: string): boolean {
  return ui.selected.includes(id);
}
function apply(next: Selection | "edit", entry: LogEntry) {
  if (next === "edit") {
    openEdit(entry.id, entry.localDate);
    return;
  }
  ui.selecting = next.selecting;
  ui.selected = next.selected;
  ui.anchor = next.anchor;
}
function tap(entry: LogEntry, event: MouseEvent) {
  apply(activateRow(
    { selecting: ui.selecting, selected: ui.selected, anchor: ui.anchor },
    ordered.value,
    entry.id,
    { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey },
  ), entry);
}
function check(entry: LogEntry, event: MouseEvent) {
  apply(activateMark(
    { selecting: ui.selecting, selected: ui.selected, anchor: ui.anchor },
    ordered.value,
    entry.id,
    event.shiftKey,
  ), entry);
}
function copy(entry: LogEntry) {
  ui.selected = [entry.id];
  ui.anchor = entry.id;
  openCopy(true);
}
async function del(entry: LogEntry) {
  await removeEntries([entry]);
}
const emptyTitle = computed(() => {
  if (isToday.value) return "Nothing logged yet today";
  return isLater.value ? `Nothing planned for ${dayMonth(props.date)}` : `Nothing logged on ${dayMonth(props.date)}`;
});
const emptyHint = computed(() => {
  if (isToday.value) return "Add food as you eat — each entry gets the time you add it.";
  return isLater.value ? "Plan food for this day and pick the time you'll eat it." : "Add food to this day and pick the time it was eaten.";
});
function add() {
  openFood("search", props.date);
}
const groupChips = computed(() => savedGroups.list.slice(0, 3));
onMounted(() => { void loadGroups(); });
async function quickGroup(id: string, name: string) {
  if (props.date !== props.today) {
    openFood("search", props.date);
    return;
  }
  const result = await readdSavedGroup(id, {
    localDate: props.date,
    timeZone: deviceTimeZone(),
    time: null,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!result.ok) {
    toastError(result.message);
    return;
  }
  const kcal = result.entries.reduce((sum, entry) => sum + entry.kcal, 0);
  const undo = result.entries.length ? { label: "Undo", run: () => { void removeEntries(result.entries, { announce: false }); } } : undefined;
  // A notice (a food that is gone) stays its own toast so it isn't folded away.
  toast(readdToast(name, result.entries.length, kcal, result.notice), undo,
    undo && !result.notice.trim() ? { merge: { kind: "add", count: result.entries.length, kcal } } : {});
}

function hold(id: string) {
  startSelect(id);
  ui.anchor = id;
}
</script>

<template>
  <div class="tl" :class="{ compact, selecting: ui.selecting, limited: Boolean(maxRows) }">
    <div v-if="showEmpty && !rows.length" class="empty col">
      <span class="eic"><Icon name="food" :size="22" /></span>
      <span class="t-head">{{ emptyTitle }}</span>
      <span class="t-label c2">{{ emptyHint }}</span>
      <button type="button" class="btn primary t-bodys ebtn" @click="add"><Icon name="plus" :size="18" :sw="2.6" /> Add food</button>
      <template v-if="groupChips.length">
        <span class="t-capn c3">or add a saved group</span>
        <div class="row gchips">
          <button v-for="group in groupChips" :key="group.id" type="button" class="btn sm secondary t-label" :aria-label="`Add group ${group.name}`" @click="quickGroup(group.id, group.name)">
            <Icon name="layers" :size="13" /> {{ group.name }}
          </button>
        </div>
      </template>
    </div>
    <template v-else>
      <div v-if="rows.length && !home" class="row selhead">
        <span class="grow" />
        <button v-if="ui.selecting" type="button" class="btn sm primary t-label" @click="endSelect()">Done</button>
        <button v-else type="button" class="btn sm secondary t-label" @click="startSelect()">Select</button>
      </div>
      <CappedList
        v-if="rows.length"
        :max-rows="maxRows"
        :watch-key="`${date}:${rows.length}`"
        class="entries"
        data-log-entries
      >
      <LogRow
        v-for="entry in rows"
        :key="entry.id"
        :entry="entry"
        :selected="selected(entry.id)"
        :selecting="ui.selecting"
        :oneline="home && Boolean(maxRows)"
        @tap="tap(entry, $event)"
        @check="check(entry, $event)"
        @copy="copy(entry)"
        @delete="del(entry)"
        @hold="hold(entry.id)"
      />
      </CappedList>
      <button v-if="!home && rows.length" type="button" class="addrow row" :disabled="ui.selecting" @click="add">
        <span class="cbtn fit addc" style="--s: var(--control-s-sm)" aria-hidden="true"><Icon name="plus" :size="13" :sw="2.4" /></span>
        <span class="t-body c2">{{ isToday ? "Add food" : `Add food to ${dayMonth(date)}` }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 0; min-width: 0; max-width: 100%; overflow: hidden; }
.selhead { min-height: 44px; }
/* The list element is rendered by CappedList, so rules on it go through :deep. */
.tl :deep(.entries) {
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  padding-top: 0;
  padding-bottom: 0;
}
/* With a row cap the scroll bar sits in the card's padding, so the outer clip is lifted; the list clips sideways itself. */
.tl.limited { overflow: visible; }
.tl :deep(.entries > .swipe:not(:first-child)) { border-top: 1px solid var(--color-border); }
.addrow { min-height: var(--control-hit); gap: var(--space-m); align-items: center; text-align: left; margin-top: var(--space-s); }
.addrow:disabled { opacity: .35; cursor: default; }
.addc { pointer-events: none; }
.empty { align-items: center; text-align: center; gap: var(--space-s); padding: var(--space-2xl) var(--space-l); border-radius: var(--radius-l); border: 1px dashed var(--color-border); }
.eic { width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); box-shadow: var(--d-edge); }
.ebtn { margin-top: var(--space-s); }
.gchips { gap: var(--space-s); flex-wrap: wrap; justify-content: center; }
</style>
