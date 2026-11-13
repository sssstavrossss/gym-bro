<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Icon from "./Icon.vue";
import SwipeRow from "./SwipeRow.vue";
import { byTime } from "../lib/dayLog";
import { dayMonth } from "../lib/dates";
import { int } from "../lib/format";
import { readdToast } from "../lib/groups";
import { activateMark, activateRow, longPressMoved, longPressMs, type Selection } from "../lib/selection";
import { vp } from "../lib/viewport";
import { removeEntries, retryPending, type LogEntry, type PendingAdd } from "../state/log";
import { loadGroups, readdSavedGroup, savedGroups } from "../state/groups";
import { deviceTimeZone } from "../state/profile";
import { openCopy, openEdit, openFood, startSelect, toast, ui } from "../ui";

const props = defineProps<{ date: string; today: string; entries: LogEntry[]; pending: PendingAdd[]; compact?: boolean; showEmpty?: boolean; home?: boolean }>();
const rows = computed(() => byTime(props.entries));
const ordered = computed(() => rows.value.map((entry) => entry.id));
const isToday = computed(() => props.date === props.today);

function amountOf(entry: LogEntry): string {
  if (entry.unit && entry.amount) return `${entry.amount} ${entry.unit}`;
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
async function retry(pending: PendingAdd) {
  await retryPending(pending.idempotencyKey);
}
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
    toast(result.message);
    return;
  }
  const kcal = result.entries.reduce((sum, entry) => sum + entry.kcal, 0);
  toast(readdToast(name, result.entries.length, kcal, result.notice), result.entries.length ? {
    label: "Undo",
    run: () => { void removeEntries(result.entries, { announce: false }); },
  } : undefined);
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
  <div class="tl" :class="{ compact, selecting: ui.selecting }">
    <div v-if="showEmpty && !rows.length && !pending.length" class="empty col">
      <span class="eic"><Icon name="food" :size="22" /></span>
      <span class="t-head">{{ isToday ? "Nothing logged yet today" : `Nothing logged on ${dayMonth(date)}` }}</span>
      <span class="t-label c2">{{ isToday ? "Add food as you eat — each entry gets the time you add it." : "Add food to this day and pick the time it was eaten." }}</span>
      <button type="button" class="primary-btn t-bodys ebtn" @click="add"><Icon name="plus" :size="18" :sw="2.6" /> Add food</button>
      <template v-if="groupChips.length">
        <span class="t-capn c3">or add a saved group</span>
        <div class="row gchips">
          <button v-for="group in groupChips" :key="group.id" type="button" class="chip t-label" :aria-label="`Add group ${group.name}`" @click="quickGroup(group.id, group.name)">
            <Icon name="layers" :size="13" /> {{ group.name }}
          </button>
        </div>
      </template>
    </div>
    <template v-else>
      <div v-if="rows.length && !ui.selecting && !home" class="row selhead">
        <span class="grow" />
        <button type="button" class="chip t-label" @click="startSelect()">Select</button>
      </div>
      <div v-if="pending.length || rows.length" class="entries" data-log-entries>
      <div v-for="item in pending" :key="item.idempotencyKey" class="pending">
        <span class="time t-label c2">{{ item.time || "Now" }}</span>
        <span class="col two">
          <span class="t-body name">{{ item.name }}</span>
          <span class="t-capn c2 sub">Pending · {{ macros(item) }}</span>
        </span>
        <button type="button" class="chip t-label" @click="retry(item)">Retry</button>
        <span class="t-bodys kc" data-num>{{ int(item.kcal) }}</span>
      </div>
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
            <span class="dot" /><Icon name="check" :size="12" :sw="3.4" class="tick" />
          </button>
          <button type="button" class="frow" :title="entry.name" @click="tap(entry, $event)">
            <span class="time t-label num" :class="selected(entry.id) ? '' : 'c2'">{{ entry.time }}</span>
            <span class="col two">
              <span class="t-body name">{{ entry.name }}</span>
              <span class="t-capn c2 sub">{{ amountOf(entry) ? `${amountOf(entry)} · ` : "" }}{{ macros(entry) }}</span>
            </span>
            <span class="t-bodys kc" data-num>{{ int(entry.kcal) }}</span>
          </button>
          <span v-if="vp.hover && !ui.selecting" class="hacts row">
            <button type="button" class="hbtn" :aria-label="`Copy ${entry.name} to another day`" title="Copy to…" @click.stop="copy(entry)">
              <Icon name="copy" :size="16" />
            </button>
            <button type="button" class="hbtn" :aria-label="`Delete ${entry.name}`" title="Delete" @click.stop="del(entry)">
              <Icon name="trash" :size="16" />
            </button>
          </span>
        </div>
      </SwipeRow>
      </div>
      <button v-if="(rows.length || pending.length) && !ui.selecting" type="button" class="addrow row" @click="add">
        <span class="cbtn fit addc" style="--s: var(--control-s-sm)" aria-hidden="true"><Icon name="plus" :size="13" :sw="2.4" /></span>
        <span class="t-body c2">{{ isToday ? "Add food" : `Add food to ${dayMonth(date)}` }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 0; min-width: 0; max-width: 100%; overflow: hidden; }
.selhead { min-height: 44px; }
.entries {
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  padding-top: 0;
  padding-bottom: 0;
}
.entries > .pending:not(:first-child),
.entries > :deep(.swipe:not(:first-child)) { border-top: 1px solid var(--color-border); }
.line {
  position: relative; display: flex; align-items: center; gap: 2px;
  width: 100%; min-height: 52px; min-width: 0; max-width: 100%; box-sizing: border-box;
  border-radius: 0; overflow: hidden; -webkit-touch-callout: none; user-select: none;
  transition: gap .18s ease;
}
/* The mark already occupies its slot. A 100% row beside it would grow past the card. */
.tl.selecting .line { gap: calc(var(--space-gap) / 2); }
.line.sel { background: color-mix(in srgb, var(--text-primary) 7%, transparent); }
.frow {
  min-height: 52px; flex: 1 1 0%; min-width: 0; width: auto; max-width: 100%; text-align: left;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: 6px; background: transparent; border-radius: 10px; padding: 4px 0;
}
.pending {
  min-height: 52px; min-width: 0; max-width: 100%;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center; gap: 6px; border-radius: 0; padding: 8px 0;
}
.time { width: auto; min-width: 2.5rem; font-variant-numeric: tabular-nums; }
.two { gap: 1px; min-width: 0; align-items: flex-start; }
.name, .sub {
  display: block; min-width: 0; max-width: 100%;
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
  text-overflow: clip;
}
.frow .kc, .pending .kc {
  width: auto; min-width: 2.5rem; max-width: none; overflow-wrap: normal;
  text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.addrow { min-height: var(--control-hit); gap: var(--space-gap); align-items: center; text-align: left; margin-top: 8px; }
.addc { pointer-events: none; }
.mark { position: relative; width: 44px; height: 44px; flex: none; }
/* The hit target stays 44px. The dot sits in the vertical centre of that target. */
.dot, .tick {
  position: absolute; left: auto; right: 2px; top: 50%;
  transform: translate(0, -50%);
  transition: width .18s ease, height .18s ease, background .18s ease, box-shadow .18s ease, right .18s ease, left .18s ease, transform .18s ease;
}
.dot { width: 8px; height: 8px; border-radius: 4px; background: var(--text-tertiary); }
.tick { color: var(--color-on-action); opacity: 0; }
/* In select mode the 22px circle owns the centre of the 44px slot, clear of the time. */
.selecting .dot, .selecting .tick, .mark.on .dot, .mark.on .tick {
  left: 50%; right: auto; transform: translate(-50%, -50%);
}
.selecting .dot, .mark.on .dot { width: 22px; height: 22px; border-radius: 11px; }
.selecting .dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-tertiary); }
.mark.on .dot { background: var(--color-action); box-shadow: none; }
.mark.on .tick { opacity: 1; }
.hacts { position: absolute; right: 0; top: 0; bottom: 0; gap: 4px; align-items: center; opacity: 0; pointer-events: none; }
.hbtn {
  position: relative; width: var(--control-hit); height: var(--control-hit);
  display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: transparent; isolation: isolate;
}
.hbtn::before {
  content: ""; position: absolute; z-index: -1; width: var(--control-s); height: var(--control-s);
  border-radius: 10px; background: var(--color-surface-2);
}
.hbtn > * { position: relative; }
.hbtn:hover, .hbtn:focus-visible { color: var(--text-primary); }
.hbtn:hover::before, .hbtn:focus-visible::before { background: var(--shade-off); }
@media (hover: hover) and (pointer: fine) {
  .line:hover .hacts, .line:focus-within .hacts { opacity: 1; pointer-events: auto; }
  .line:hover .kc, .line:focus-within .kc { opacity: 0; }
  .line:hover .mark { cursor: pointer; }
  .line:hover .dot, .line:hover .tick { left: 50%; right: auto; transform: translate(-50%, -50%); }
  .line:hover .dot { width: 22px; height: 22px; border-radius: 11px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
  .line:hover .mark.on .dot { background: var(--color-action); box-shadow: none; }
}
.empty { align-items: center; text-align: center; gap: 8px; padding: 28px 16px; border-radius: var(--radius-card); border: 1px dashed var(--color-border); }
.eic { width: var(--control-s); height: var(--control-s); border-radius: 50%; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
.ebtn { width: auto; padding: 0 22px; min-height: 44px; margin-top: 8px; }
.gchips { gap: 8px; flex-wrap: wrap; justify-content: center; }
</style>
