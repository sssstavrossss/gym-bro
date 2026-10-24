<script setup lang="ts">
// One day's food as a timeline (no meal types). Entries close together form a visual cluster.
// Touch: swipe left for Copy to… / Delete, hold ~0.5 s to start selecting. Mouse: hover for actions,
// click the circle (or Ctrl/⌘-click) to select, Shift-click for a range. Tap/click a row to edit it.
import { computed } from "vue";
import CircleBtn from "./CircleBtn.vue";
import SwipeRow from "./SwipeRow.vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { vp } from "../lib/viewport";
import { dayMonth } from "../lib/dates";
import { amountOf, clustersFor, entriesFor, groupKcal, logGroup, removeEntries, restoreEntries, state, today, type Entry, type SavedGroup } from "../store";
import { nowHM } from "../lib/time";
import { openCopy, openEdit, openFood, startSelect, toast, toggleSelected, ui } from "../ui";

const props = defineProps<{ date: string; compact?: boolean }>();
const clusters = computed(() => clustersFor(props.date));
const flat = computed(() => entriesFor(props.date));
const isSel = (id: string) => ui.selected.includes(id);

// ---- long-press (touch) ----
let timer: ReturnType<typeof setTimeout> | undefined;
let sx = 0, sy = 0, suppress = false;
function pdown(e: PointerEvent, id: string) {
  if (e.pointerType === "mouse" || ui.selecting) return;
  sx = e.clientX; sy = e.clientY;
  clearTimeout(timer);
  timer = setTimeout(() => {
    suppress = true;
    startSelect(id); ui.anchor = id;
    navigator.vibrate?.(10);
  }, 480);
}
function pmove(e: PointerEvent) { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) clearTimeout(timer); }
function pup() { clearTimeout(timer); }

function tap(e: Entry, ev: MouseEvent) {
  if (suppress) { suppress = false; return; }
  if (ev.shiftKey && (ui.selecting || ui.anchor)) return range(e.id);
  if (ui.selecting) { toggleSelected(e.id); ui.anchor = e.id; if (!ui.selected.length) ui.selecting = false; return; }
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey) { startSelect(e.id); ui.anchor = e.id; return; }
  openEdit(e);
}
function check(e: Entry, ev: MouseEvent) {
  if (ev.shiftKey && ui.anchor) return range(e.id);
  if (!ui.selecting) startSelect(e.id); else toggleSelected(e.id);
  ui.anchor = e.id;
  if (!ui.selected.length) ui.selecting = false;
}
function range(id: string) {
  const ids = flat.value.map((e) => e.id);
  const a = ids.indexOf(ui.anchor ?? id), b = ids.indexOf(id);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (!ui.selecting) startSelect();
  for (const x of ids.slice(lo, hi + 1)) if (!isSel(x)) ui.selected.push(x);
}
function toggleCluster(items: Entry[]) {
  const all = items.every((e) => isSel(e.id));
  if (all) ui.selected = ui.selected.filter((x) => !items.some((e) => e.id === x));
  else for (const e of items) if (!isSel(e.id)) ui.selected.push(e.id);
}

function copy(e: Entry) { startSelect(e.id); openCopy(true); }
function del(e: Entry) {
  const removed = removeEntries([e.id]);
  toast(`Deleted ${e.name}`, { label: "Undo", run: () => restoreEntries(removed) });
}
function quickGroup(g: SavedGroup) {
  // Past day: no default time — open Add food for that day, where adding the group asks for the time first.
  if (props.date !== today) return openFood({ date: props.date });
  const ids = logGroup(g, props.date, nowHM());
  toast(`Added ${g.name} · ${int(groupKcal(g))} kcal`, { label: "Undo", run: () => removeEntries(ids) });
}
const range2 = (c: { start: string; end: string }) => (c.start === c.end ? c.start : `${c.start}–${c.end}`);
</script>

<template>
  <div class="tl" :class="{ selecting: ui.selecting, compact, phone: !vp.tablet }">
    <!-- Empty day -->
    <div v-if="!clusters.length" class="empty col">
      <span class="eic"><Icon name="food" :size="22" /></span>
      <span class="t-head">{{ date === today ? "Nothing logged yet today" : `Nothing logged on ${dayMonth(date)}` }}</span>
      <span class="t-label c2">{{ date === today ? "Add food as you eat — each entry gets the time you add it." : "Add food to this day and pick the time it was eaten." }}</span>
      <button type="button" class="primary-btn t-bodys ebtn" @click="openFood({ date })"><Icon name="plus" :size="18" :sw="2.6" />&nbsp;Add food</button>
      <template v-if="state.groups.length">
        <span class="t-capn c3">or add a saved group</span>
        <div class="row gchips">
          <button v-for="g in state.groups.slice(0, 3)" :key="g.id" type="button" class="chip t-label" @click="quickGroup(g)"><Icon name="layers" :size="13" />&nbsp;{{ g.name }}</button>
        </div>
      </template>
    </div>

    <template v-else>
      <section v-for="c in clusters" :key="c.start + c.items[0].id" class="cluster">
        <div v-if="c.items.length > 1 || ui.selecting" class="chead row">
          <span class="t-capn c3">{{ range2(c) }}</span>
          <span class="grow" />
          <button v-if="ui.selecting" type="button" class="t-capn csel" @click="toggleCluster(c.items)">{{ c.items.every((e) => isSel(e.id)) ? "Deselect" : `Select ${c.items.length}` }}</button>
          <span v-else-if="c.items.length > 1" class="t-capn c3">{{ int(c.kcal) }} kcal</span>
        </div>
        <TransitionGroup name="rows" tag="div" class="col">
          <SwipeRow v-for="(e, i) in c.items" :key="e.id" :id="e.id" :swipe="!vp.hover && !ui.selecting" @copy="copy(e)" @delete="del(e)" @tap="tap(e, $event)">
            <div class="frow row" :class="{ sel: isSel(e.id), last: i === c.items.length - 1, first: i === 0 }"
              @pointerdown="pdown($event, e.id)" @pointermove="pmove" @pointerup="pup" @pointercancel="pup" @contextmenu="!vp.hover && $event.preventDefault()">
              <span class="time t-label num" :class="isSel(e.id) ? '' : 'c2'">{{ e.time }}</span>
              <button type="button" class="mark" :class="{ on: isSel(e.id) }" :aria-pressed="isSel(e.id)" :aria-label="`${isSel(e.id) ? 'Deselect' : 'Select'} ${e.name}`" :tabindex="ui.selecting || vp.hover ? 0 : -1"
                @click.stop="check(e, $event)">
                <span class="dot" /><Icon name="check" :size="12" :sw="3.4" class="tick" />
              </button>
              <!-- phone: two lines (name / amount · macros) so names don't truncate; wider: one line -->
              <span v-if="!vp.tablet" class="col grow two">
                <span class="t-body name">{{ e.name.replace(/, cooked$/, "") }}</span>
                <span class="t-capn c2 nowrap">{{ amountOf(e) ? `${amountOf(e)} · ` : "" }}P{{ e.p }} F{{ e.f }} C{{ e.c }}</span>
              </span>
              <template v-else>
                <span class="t-body name">{{ e.name.replace(/, cooked$/, "") }}</span>
                <span v-if="amountOf(e)" class="t-label c2 nowrap">{{ amountOf(e) }}</span>
                <span class="grow" />
                <span v-if="!compact || vp.wide" class="t-label c2 nowrap mac">P{{ e.p }}&nbsp; F{{ e.f }}&nbsp; C{{ e.c }}</span>
              </template>
              <span v-if="vp.hover && !ui.selecting" class="hacts row">
                <button type="button" class="hbtn" :aria-label="`Copy ${e.name} to another day`" title="Copy to…" @click.stop="copy(e)"><Icon name="copy" :size="15" /></button>
                <button type="button" class="hbtn" :aria-label="`Delete ${e.name}`" title="Delete" @click.stop="del(e)"><Icon name="trash" :size="15" /></button>
              </span>
              <span class="t-bodys kc">{{ e.kcal }}</span>
            </div>
          </SwipeRow>
        </TransitionGroup>
      </section>
      <button v-if="!ui.selecting" type="button" class="addrow row" @click="openFood({ date })">
        <span class="time" /><span class="cbtn addc" style="--s: 24px" aria-hidden="true"><Icon name="plus" :size="13" :sw="2.4" /></span>
        <span class="t-body c2">{{ date === today ? "Add food" : `Add food to ${dayMonth(date)}` }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 14px; }
.cluster { display: flex; flex-direction: column; }
.chead { min-height: 24px; gap: 8px; padding-left: 0; }
.csel { color: var(--text-primary); padding: 4px 0; text-decoration: underline; text-underline-offset: 3px; }
.frow { min-height: 44px; gap: 8px; position: relative; -webkit-touch-callout: none; }
.frow::after { content: ""; position: absolute; left: 82px; right: 0; bottom: 0; height: 1px; background: var(--color-border); }
.frow.last::after { left: 0; }
.time { width: 2.3529rem; flex: none; }
/* timeline marker: dot joined by a line within a cluster; becomes a checkbox when selecting */
.two { gap: 1px; min-width: 0; }
.two .name { max-width: 100%; }
.phone .frow { min-height: 52px; }
.mark { position: relative; width: 26px; align-self: stretch; flex: none; display: flex; align-items: center; justify-content: center; cursor: default; }
.mark::before { content: ""; position: absolute; left: 50%; width: 1.5px; margin-left: -0.75px; top: 0; bottom: 0; background: var(--color-track); }
.first .mark::before { top: 50%; }
.last .mark::before { bottom: 50%; }
.first.last .mark::before { display: none; }
.dot { position: relative; width: 8px; height: 8px; border-radius: 4px; background: var(--text-tertiary); transition: all .15s; }
.tick { position: absolute; color: var(--color-on-action); opacity: 0; }
.selecting .mark { cursor: pointer; }
.selecting .dot { width: 20px; height: 20px; border-radius: 10px; background: var(--color-bg); box-shadow: inset 0 0 0 1.5px var(--text-tertiary); }
.mark.on .dot { width: 20px; height: 20px; border-radius: 10px; background: var(--color-action); box-shadow: none; }
.mark.on .tick { opacity: 1; }
.frow.sel { background: rgba(255,255,255,.05); }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.nowrap { white-space: nowrap; }
.kc { min-width: 2.3529rem; text-align: right; flex: none; }
.addrow { min-height: 44px; gap: 8px; text-align: left; }
.addrow .addc { margin: 0 1px; pointer-events: none; }
.hacts { position: absolute; right: 48px; top: 0; bottom: 0; gap: 4px; opacity: 0; pointer-events: none; transition: opacity .12s; }
.hbtn { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); background: var(--color-surface-2); }
.hbtn:hover { color: #fff; background: var(--shade-off); }
@media (hover: hover) and (pointer: fine) {
  .frow:hover { cursor: pointer; }
  .frow:hover .mac, .frow:focus-within .mac { opacity: 0; }
  .frow:hover .hacts, .frow:focus-within .hacts { opacity: 1; pointer-events: auto; }
  /* hover shows the select circle in place of the dot */
  .frow:hover .mark { cursor: pointer; }
  .frow:hover .dot { width: 20px; height: 20px; border-radius: 10px; background: var(--color-bg); box-shadow: inset 0 0 0 1.5px var(--text-secondary); }
  .frow:hover .mark.on .dot { background: var(--color-action); box-shadow: none; }
  .addrow:hover .c2 { color: var(--text-primary); }
}
.empty { align-items: center; text-align: center; gap: 8px; padding: 28px 16px; border-radius: var(--radius-card); border: 1px dashed var(--color-border); }
.eic { width: 44px; height: 44px; border-radius: 22px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); margin-bottom: 4px; }
.ebtn { width: auto; padding: 0 22px; min-height: 44px; margin: 8px 0 4px; }
.gchips { gap: 8px; flex-wrap: wrap; justify-content: center; }
.rows-leave-active { transition: opacity .2s, transform .2s; }
.rows-leave-to { opacity: 0; transform: translateX(-30px); }
.rows-enter-active { transition: opacity .25s; }
.rows-enter-from { opacity: 0; }
.mark::after { content: ""; position: absolute; inset: 0 -9px; } /* 44 pt hit area */
.dt-l .name { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
</style>
