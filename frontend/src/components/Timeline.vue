<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CappedList from "./CappedList.vue";
import Icon from "./Icon.vue";
import SelectMark from "./SelectMark.vue";
import SwipeRow from "./SwipeRow.vue";
import { byTime } from "../lib/dayLog";
import { dayMonth } from "../lib/dates";
import { int } from "../lib/format";
import { readdToast } from "../lib/groups";
import { activateMark, activateRow, longPressMoved, longPressMs, type Selection } from "../lib/selection";
import { vp } from "../lib/viewport";
import { removeEntries, type LogEntry } from "../state/log";
import { loadGroups, readdSavedGroup, savedGroups } from "../state/groups";
import { deviceTimeZone } from "../state/profile";
import { foodAmount } from "../state/units";
import { endSelect, openCopy, openEdit, openFood, startSelect, toast, toastError, ui } from "../ui";

const props = defineProps<{ date: string; today: string; entries: LogEntry[]; compact?: boolean; showEmpty?: boolean; home?: boolean; maxRows?: number }>();
const rows = computed(() => byTime(props.entries));
const ordered = computed(() => rows.value.map((entry) => entry.id));
const isToday = computed(() => props.date === props.today);
const isLater = computed(() => props.date > props.today);

function amountOf(entry: LogEntry): string {
  if (entry.unit && entry.amount) return foodAmount(entry.amount, entry.unit);
  return "";
}
function macros(entry: { protein: number; fat: number; carbs: number }): string {
  return `P${int(entry.protein)} F${int(entry.fat)} C${int(entry.carbs)}`;
}
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

let timer = 0;
let sx = 0;
let sy = 0;
const suppress = ref(false);
function pdown(event: PointerEvent, id: string) {
  if (event.pointerType === "mouse" || ui.selecting || vp.hover) return;
  sx = event.clientX;
  sy = event.clientY;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    suppress.value = true;
    startSelect(id);
    ui.anchor = id;
    navigator.vibrate?.(10);
  }, longPressMs);
}
function pmove(event: PointerEvent) {
  if (longPressMoved(event.clientX - sx, event.clientY - sy)) window.clearTimeout(timer);
}
function pup() {
  window.clearTimeout(timer);
}
function swallow(event: MouseEvent) {
  if (!suppress.value) return;
  suppress.value = false;
  event.preventDefault();
  event.stopPropagation();
}
function onMenu(event: Event) {
  if (!vp.hover) event.preventDefault();
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
        :class="{ oneline: home && Boolean(maxRows) }"
        data-log-entries
      >
      <SwipeRow
        v-for="entry in rows"
        :key="entry.id"
        :id="entry.id"
        :swipe="!vp.hover && !ui.selecting"
        :copy-label="`Copy ${entry.name} to another day`"
        :delete-label="`Delete ${entry.name}`"
        @copy="copy(entry)"
        @delete="del(entry)"
      >
        <div
          class="line"
          :class="{ sel: selected(entry.id) }"
          @pointerdown="pdown($event, entry.id)"
          @pointermove="pmove"
          @pointerup="pup"
          @pointercancel="pup"
          @click.capture="swallow"
          @contextmenu="onMenu"
        >
          <button
            type="button"
            class="mark"
            :class="{ on: selected(entry.id) }"
            :aria-pressed="selected(entry.id)"
            :aria-label="`${selected(entry.id) ? 'Deselect' : 'Select'} ${entry.name}`"
            :tabindex="ui.selecting || vp.hover ? 0 : -1"
            @click.stop="check(entry, $event)"
          >
            <SelectMark :on="selected(entry.id)" />
          </button>
          <button type="button" class="frow" :title="entry.name" @click="tap(entry, $event)">
            <span class="time t-label num" :class="selected(entry.id) ? '' : 'c2'">{{ entry.time }}</span>
            <span class="col two">
              <span class="t-body name">{{ entry.name }}</span>
              <span class="t-capn c2 sub">
                {{ amountOf(entry) ? `${amountOf(entry)} · ` : "" }}<!--
                A refused add drops its macros so "couldn't send" fits on one line.
                --><span v-if="entry.queued === 'failed'" class="qmark" data-queued="failed"><Icon name="alert" :size="13" />couldn't send</span><!--
                --><template v-else>{{ macros(entry) }}<template v-if="entry.queued"> · <span class="qmark" data-queued="waiting"><Icon name="cloud-off" :size="13" />waiting</span></template></template>
              </span>
            </span>
            <!-- A refused entry counts for nothing until it is saved again, so no number. -->
            <span class="t-bodys kc" data-num>{{ entry.queued === "failed" ? "" : int(entry.kcal) }}</span>
          </button>
          <span v-if="vp.hover && !ui.selecting" class="hacts row">
            <button v-if="entry.queued !== 'failed'" type="button" class="hbtn" :aria-label="`Copy ${entry.name} to another day`" title="Copy to…" @click.stop="copy(entry)">
              <Icon name="copy" :size="16" />
            </button>
            <button type="button" class="hbtn" :aria-label="`Delete ${entry.name}`" title="Delete" @click.stop="del(entry)">
              <Icon name="trash" :size="16" />
            </button>
          </span>
        </div>
      </SwipeRow>
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
/* Phone Home card (capped): one line per name and amount, so five rows are always the same height. */
.entries.oneline .name, .entries.oneline .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; word-break: normal; }
.entries.oneline .two { max-width: 100%; }
.entries.oneline .two > * { width: 100%; }
.tl :deep(.entries > .swipe:not(:first-child)) { border-top: 1px solid var(--color-border); }
.line {
  position: relative; display: flex; align-items: center; gap: var(--space-s);
  width: 100%; min-height: 52px; min-width: 0; max-width: 100%; box-sizing: border-box;
  border-radius: 0; overflow: hidden; -webkit-touch-callout: none; user-select: none;
}
.line.sel { background: color-mix(in srgb, var(--text-primary) 7%, transparent); }
.frow {
  min-height: 52px; flex: 1 1 0%; min-width: 0; width: auto; max-width: 100%; text-align: left;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--space-s); background: transparent; border-radius: var(--radius-m); padding: var(--space-xs) 0;
}
.time { width: auto; min-width: 2.5rem; font-variant-numeric: tabular-nums; }
.two { gap: 1px; min-width: 0; align-items: flex-start; }
.name, .sub {
  display: block; min-width: 0; max-width: 100%;
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
  text-overflow: clip;
}
.frow .kc {
  width: auto; min-width: 2.5rem; max-width: none; overflow-wrap: normal;
  text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
}
/* "waiting" and "couldn't send" ride on the detail line, icon and word together. */
.qmark { display: inline-flex; align-items: center; gap: 3px; vertical-align: -2px; white-space: nowrap; }
.addrow { min-height: var(--control-hit); gap: var(--space-m); align-items: center; text-align: left; margin-top: var(--space-s); }
.addrow:disabled { opacity: .35; cursor: default; }
.addc { pointer-events: none; }
.mark { position: relative; width: 44px; height: 44px; flex: none; }
.hacts { position: absolute; right: 0; top: 0; bottom: 0; gap: var(--space-xs); align-items: center; opacity: 0; pointer-events: none; }
.hbtn {
  position: relative; width: var(--control-hit); height: var(--control-hit);
  display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: transparent; isolation: isolate;
}
.hbtn::before {
  content: ""; position: absolute; z-index: -1; width: var(--control-s); height: var(--control-s);
  border-radius: var(--radius-m); background: var(--color-surface-2);
}
.hbtn > * { position: relative; }
.hbtn:hover, .hbtn:focus-visible { color: var(--text-primary); }
.hbtn:hover::before, .hbtn:focus-visible::before { background: var(--shade-off); }
@media (hover: hover) and (pointer: fine) {
  .line:hover .hacts, .line:focus-within .hacts { opacity: 1; pointer-events: auto; }
  .line:hover .kc, .line:focus-within .kc { opacity: 0; }
  .line:hover .mark { cursor: pointer; }
}
.empty { align-items: center; text-align: center; gap: var(--space-s); padding: var(--space-2xl) var(--space-l); border-radius: var(--radius-l); border: 1px dashed var(--color-border); }
.eic { width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
.ebtn { margin-top: var(--space-s); }
.gchips { gap: var(--space-s); flex-wrap: wrap; justify-content: center; }
</style>
