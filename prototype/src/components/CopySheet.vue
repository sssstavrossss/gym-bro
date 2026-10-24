<script setup lang="ts">
// Copy the selected entries to a chosen day. Times are kept; they can be edited afterwards.
import { computed, ref, watch } from "vue";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import Icon from "./Icon.vue";
import { int } from "../lib/format";
import { addDays, shortDate } from "../lib/dates";
import { copyEntries, removeEntries, state, today, type Entry } from "../store";
import { closeSheet, endSelect, toast, ui } from "../ui";
import { useRouter } from "vue-router";

const router = useRouter();
const open = computed(() => ui.sheet === "copy");
const list = computed(() => ui.selected.map((id) => state.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e).sort((a, b) => a.time.localeCompare(b.time)));
const from = computed(() => list.value[0]?.date ?? today);
const kcal = computed(() => list.value.reduce((a, e) => a + e.kcal, 0));
const target = ref(today);
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
const custom = ref("");
watch(open, (o) => { if (o) { target.value = today; custom.value = ""; } });
const label = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : shortDate(d));
const times = computed(() => {
  const l = list.value;
  if (!l.length) return "";
  return l[0].time === l[l.length - 1].time ? l[0].time : `${l[0].time}–${l[l.length - 1].time}`;
});
function tryPicker(e: Event) { try { (e.target as HTMLInputElement).showPicker(); } catch { /* native fallback */ } }
function pickCustom(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  if (v && v <= today) { custom.value = v; target.value = v; }
}
function close() { if (ui.copySingle) endSelect(); closeSheet(); }
function copy() {
  const ids = copyEntries(list.value, target.value);
  const n = list.value.length;
  const to = target.value;
  toast(`Copied ${n} item${n > 1 ? "s" : ""} · ${int(kcal.value)} kcal to ${label(to).replace(/^T/, "t").replace(/^Y/, "y")}`, { label: "Undo", run: () => removeEntries(ids) });
  endSelect();
  closeSheet();
  if (to !== from.value) router.push(to === today ? "/log" : `/log/${to}`);
}
</script>

<template>
  <BottomSheet :open="open" label="Copy to" compact @close="close">
    <template #header>
      <div class="row hdr">
        <div class="col grow"><h2 class="t-head">Copy {{ list.length }} item{{ list.length > 1 ? "s" : "" }} to…</h2>
          <span class="t-label c2">{{ int(kcal) }} kcal · from {{ label(from) }}</span></div>
        <CircleBtn icon="x" label="Close" @click="close" />
      </div>
    </template>
    <div class="opts col" role="radiogroup" aria-label="Day">
      <button v-for="d in days" :key="d" type="button" role="radio" :aria-checked="target === d" class="opt row" :class="{ on: target === d }" @click="target = d; custom = ''">
        <span class="t-body grow">{{ label(d) }}<span v-if="d === from" class="c3"> · same day (duplicate)</span></span>
        <span class="t-label c3">{{ d === today || d === addDays(today, -1) ? shortDate(d) : "" }}</span>
        <span class="radio" :class="{ on: target === d }"><Icon v-if="target === d" name="check" :size="12" :sw="3.2" /></span>
      </button>
      <label class="opt row" :class="{ on: custom && target === custom }">
        <span class="t-body grow">{{ custom ? label(custom) : "Another date…" }}</span>
        <Icon name="cal" :size="16" class="c2" />
        <input class="dinput" type="date" :max="today" :value="custom" aria-label="Pick another date" @click="tryPicker" @change="pickCustom" />
      </label>
    </div>
    <p class="t-label c2 note"><Icon name="clock" :size="13" style="display:inline; vertical-align:-2px" /> Times are kept ({{ times }}). Tap an entry afterwards to change it.</p>
    <button type="button" class="primary-btn t-bodys" :disabled="!list.length" @click="copy">Copy to {{ label(target) === "Today" ? "today" : label(target) === "Yesterday" ? "yesterday" : shortDate(target) }}</button>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; align-items: flex-start; }
.opts { gap: 0; overflow-y: auto; min-height: 0; flex: 0 1 auto; }
.opt { position: relative; min-height: 48px; gap: 10px; border-bottom: 1px solid var(--color-border); text-align: left; cursor: pointer; }
.radio { width: 22px; height: 22px; border-radius: 11px; border: 1.5px solid var(--text-tertiary); display: flex; align-items: center; justify-content: center; flex: none; }
.radio.on { background: var(--color-action); border-color: var(--color-action); color: var(--color-on-action); }
.dinput { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; font-size: 16px; }
.note { margin: 0; }
.can-hover .opt:hover { background: rgba(255,255,255,.03); }
</style>
