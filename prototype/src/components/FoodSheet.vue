<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { keyboardEntry } from "../lib/viewport";
import BottomSheet from "./BottomSheet.vue";
import CircleBtn from "./CircleBtn.vue";
import Segmented from "./Segmented.vue";
import TimeChip from "./TimeChip.vue";
import Skeleton from "./Skeleton.vue";
import Keypad from "./Keypad.vue";
import Icon from "./Icon.vue";
import FoodEditor from "./FoodEditor.vue";
import { amountLabel, type Food } from "../data/foods";
import { addEntry, addServing, allFoods, createFood, dayTotals, deleteGroup, findFood, groupKcal, logGroup, macroStatus, removeEntries, removeServing, restoreEntries, state, targetFor, today, unitsFor, updateEntry, updateFood, type Entry, type SavedGroup, type UnitOpt } from "../store";
import Bar from "./Bar.vue";
import { closeSheet, entryTime, openCopy, openGroupSheet, toast, ui, type FoodTab } from "../ui";
import { kcalFromMacros } from "../lib/nutrition";
import { int } from "../lib/format";
import { dayMonth } from "../lib/dates";

const open = computed(() => ui.sheet === "food");
const tab = computed({ get: () => ui.foodTab, set: (v: FoodTab) => (ui.foodTab = v) });
const time = computed({ get: () => ui.time, set: (v: string | null) => (ui.time = v) });
/** " to 21 Oct" on a past day, "" today */
const dayNote = computed(() => (ui.date === today ? "" : ` to ${dayMonth(ui.date)}`));
/** Past day: the time must be picked (no default). Any add first asks for it, then completes. */
const needTime = computed(() => ui.date !== today && !ui.time && !ui.editEntry);
const addLabel = computed(() => (ui.editEntry ? "Save" : needTime.value ? "Pick a time to add" : ui.date !== today ? `Add${dayNote.value} at ${ui.time}` : ui.time ? `Add at ${ui.time}` : "Add"));
const chip = ref<InstanceType<typeof TimeChip> | null>(null);
let pending: null | { run: () => void; key: string } = null;
const askTime = ref(false);
watch(() => ui.time, (t) => {
  if (t && pending) { const p = pending; pending = null; askTime.value = false; guardSave(p.run, p.key); }
});

// ---------- Demo states: OFF down ("offline"), server unreachable ("unreachable"), slow ("loading") ----------
const offline = computed(() => ui.demo === "offline");
const unreachable = computed(() => ui.demo === "unreachable" || ui.demo === "down" || !navigator.onLine);
const retrying = ref(false);
function retrySearch() { retrying.value = true; setTimeout(() => (retrying.value = false), 900); }
const saveError = ref(false);
/** Every save goes through here: the same tap twice within 0.6 s adds once (double-tap guard, G31);
 *  in the "unreachable" demo it fails and keeps the entry. */
let lastKey = "", lastAt = 0;
function guardSave(run: () => void, key = "save") {
  if (needTime.value) { pending = { run, key }; askTime.value = true; chip.value?.open(); return; }
  const now = performance.now();
  if (key === lastKey && now - lastAt < 600) return;
  lastKey = key; lastAt = now;
  if (unreachable.value) { saveError.value = true; return; }
  saveError.value = false;
  run();
}

// ---------- Session (entries added since the sheet opened) ----------
const sessionEntries = computed(() => ui.session.map((id) => state.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e));
const sessionKcal = computed(() => sessionEntries.value.reduce((a, e) => a + e.kcal, 0));
function added(e: Entry) { ui.session.push(e.id); }

// ---------- Search ----------
const q = ref("");
interface Pick { food: Food; amount: number; unit: string; grams: number }
/** One-tap amount: what was logged last time (amount + unit, S2), else the food's usual. */
function usualOf(food: Food): Pick {
  const u = state.lastUsed[food.id];
  const units = unitsFor(food);
  if (u?.unit && u.amount != null) {
    const uo = units.find((x) => x.unit === u.unit);
    if (uo) return { food, amount: u.amount, unit: u.unit, grams: u.amount * uo.g };
  }
  if (u) return { food, amount: u.grams, unit: "g", grams: u.grams };
  if (food.usualUnit && food.usualAmount != null) {
    const uo = units.find((x) => x.unit === food.usualUnit);
    if (uo) return { food, amount: food.usualAmount, unit: uo.unit, grams: food.usualAmount * uo.g };
  }
  return { food, amount: food.usual, unit: "g", grams: food.usual };
}
const recent = computed(() =>
  Object.entries(state.lastUsed)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => findFood(id))
    .filter((f): f is Food => !!f && !f.deleted)
    .slice(0, 8)
    .map(usualOf),
);
const myFoods = computed(() => state.myFoods.filter((f) => !f.deleted));
const filter = computed({ get: () => ui.foodFilter, set: (v: "all" | "mine") => (ui.foodFilter = v) });
/** Local foods = the ones already used (cached) + my foods. In the "offline" demo only these are searchable. */
const results = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (filter.value === "mine") return myFoods.value.filter((f) => !s || `${f.name} ${f.brand ?? ""}`.toLowerCase().includes(s)).map(usualOf);
  if (!s) return recent.value;
  const pool = offline.value || ui.demo === "loading" ? allFoods().filter((f) => f.mine || state.lastUsed[f.id]) : allFoods();
  return pool.filter((f) => `${f.name} ${f.brand ?? ""}`.toLowerCase().includes(s)).map(usualOf);
});
/** "180 g · 297 kcal · P56 F6 C0" — in the unit it will be added in */
function rowSub(r: Pick) {
  const m = macrosOf(r.food, r.grams);
  return `${amountLabel(r.amount, r.unit)}${r.unit === "g" || r.unit === "ml" || r.food.servingOnly ? "" : ` (${int(r.grams)} g)`} · ${m.kcal} kcal · P${m.p} F${m.f} C${m.c}`;
}
const groups = computed(() => {
  const s = q.value.trim().toLowerCase();
  return state.groups.filter((g) => !s || g.name.toLowerCase().includes(s) || g.items.some((i) => i.name.toLowerCase().includes(s)));
});
const openGroup = ref<string | null>(null);
const justGroup = ref<string | null>(null);
function addGroup(g: SavedGroup) {
  guardSave(() => {
    const ids = logGroup(g, ui.date, entryTime());
    ui.session.push(...ids);
    justGroup.value = g.id;
    setTimeout(() => justGroup.value === g.id && (justGroup.value = null), 1200);
    toast(`Added ${g.name} · ${g.items.length} items · ${int(groupKcal(g))} kcal${dayNote.value}`, {
      label: "Undo", run: () => { removeEntries(ids); ui.session = ui.session.filter((i) => !ids.includes(i)); },
    });
  }, "g:" + g.id);
}
function removeGroup(g: SavedGroup) {
  const copy = { ...g };
  deleteGroup(g.id);
  toast(`Deleted group ${g.name}`, { label: "Undo", run: () => state.groups.unshift(copy) });
}
const justAdded = ref<string | null>(null);
const hi = ref(0); // keyboard-highlighted result
watch(q, () => (hi.value = 0));
function searchKey(e: KeyboardEvent) {
  const n = results.value.length;
  if (!n) return;
  if (e.key === "ArrowDown") { e.preventDefault(); hi.value = (hi.value + 1) % n; scrollHi(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); hi.value = (hi.value - 1 + n) % n; scrollHi(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const r = results.value[Math.min(hi.value, n - 1)];
    if (e.shiftKey) quickPlus(r); else openDetail(r.food, r.amount, r.unit);
  }
}
function scrollHi() { nextTick(() => document.querySelector(".rrow.hl")?.scrollIntoView({ block: "nearest" })); }
const searchEl = ref<HTMLInputElement | null>(null);
const gramsEl = ref<HTMLInputElement | null>(null);
const qNameEl = ref<HTMLInputElement | null>(null);
function focusFor() {
  if (!keyboardEntry.value || ui.sheet !== "food") return;
  nextTick(() => {
    if (ui.detailFoodId) { gramsEl.value?.focus(); gramsEl.value?.select(); }
    else if (ui.foodTab === "search") searchEl.value?.focus();
    else qNameEl.value?.focus();
  });
}
watch(() => [ui.sheet, ui.detailFoodId, ui.foodTab], focusFor);
type Per100 = { kcal: number; p: number; f: number; c: number };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** macros for a gram amount from per-100 values (a food or an entry's snapshot) */
function macrosOf(v: Per100, g: number) {
  const k = g / 100;
  return { kcal: Math.round(v.kcal * k), p: r1(v.p * k), f: r1(v.f * k), c: r1(v.c * k) };
}
const snap = (f: Food): Per100 => ({ kcal: f.kcal, p: f.p, f: f.f, c: f.c });
/** Every entry stores what was typed (amount + unit), its gram equivalent and a per-100 g snapshot (S2/S3). */
function entryFor(food: Food, amount: number, unit: string, grams: number) {
  return { foodId: food.id, name: food.name, amount, unit, grams: r1(grams), per100: snap(food), ...macrosOf(food, grams) };
}
function quickPlus(r: Pick) {
  const { food, amount, unit, grams } = r;
  guardSave(() => {
    added(addEntry({ date: ui.date, time: entryTime(), ...entryFor(food, amount, unit, grams) }));
    justAdded.value = food.id;
    setTimeout(() => justAdded.value === food.id && (justAdded.value = null), 1200);
    toast(`Added ${amountLabel(amount, unit)} ${food.name} · ${macrosOf(food, grams).kcal} kcal${dayNote.value}`);
  }, "f:" + food.id);
}

// ---------- Detail (amount + unit + keypad) ----------
const detail = computed(() => (ui.detailFoodId ? findFood(ui.detailFoodId) : undefined));
/** the amount as typed, in `unit` */
const grams = ref("0");
const unit = ref("g");
let fresh = true; // first key replaces the pre-filled amount
function openDetail(food: Food, amount: number, u = "g") {
  ui.detailFoodId = food.id;
  grams.value = String(r1(amount));
  unit.value = u;
  fresh = true;
  svOpen.value = false;
}
/** Units for this food; an edited entry keeps the unit it was logged in even if that serving is gone. */
const units = computed<UnitOpt[]>(() => {
  const f = detail.value;
  if (!f) return [];
  const list = unitsFor(f);
  const e = ui.editEntry;
  if (e?.unit && !list.some((x) => x.unit === e.unit) && e.amount) list.push({ unit: e.unit, g: (e.grams ?? 0) / e.amount });
  return list;
});
const unitG = computed(() => units.value.find((x) => x.unit === unit.value)?.g ?? 1);
const gramsNum = computed(() => Number(grams.value) || 0);
const gEq = computed(() => gramsNum.value * unitG.value);
/** values used: an edited entry keeps its logged snapshot; new adds use the food as it is now */
const values = computed<Per100>(() => ui.editEntry?.per100 ?? (detail.value ? snap(detail.value) : { kcal: 0, p: 0, f: 0, c: 0 }));
const snapDiffers = computed(() => !!(ui.editEntry?.per100 && detail.value && JSON.stringify(ui.editEntry.per100) !== JSON.stringify(snap(detail.value))));
const preview = computed(() => (detail.value ? macrosOf(values.value, gEq.value) : { kcal: 0, p: 0, f: 0, c: 0 }));
const per100 = computed(() => {
  const f = detail.value!, v = values.value;
  if (f.servingOnly) return `per ${f.servings?.[0]?.name ?? "serving"} · ${int(v.kcal)} kcal · P${v.p} F${v.f} C${v.c}`;
  return `per 100 ${f.liquid ? "ml" : "g"} · ${int(v.kcal)} kcal · P${v.p} F${v.f} C${v.c}`;
});
const isServing = computed(() => unit.value !== "g" && unit.value !== "ml");
/** switching unit keeps the same quantity where it can (120 g → 2 pieces) */
function setUnit(u: UnitOpt) {
  if (u.unit === unit.value) return;
  const g = gEq.value || unitG.value;
  unit.value = u.unit;
  const a = g / u.g;
  grams.value = String(u.unit === "g" || u.unit === "ml" ? Math.round(a) : a >= 0.5 && Math.abs(a * 2 - Math.round(a * 2)) < 0.01 ? Math.round(a * 2) / 2 : 1);
  fresh = true;
}
const quickAmounts = computed(() => (unit.value === "g" ? [100, 150, 200] : unit.value === "ml" ? [100, 250, 500] : [0.5, 1, 2, 3]));
// private custom serving ("1 slice = 35 g")
const svOpen = ref(false);
const svName = ref("slice");
const svG = ref("");
function saveServing() {
  const f = detail.value, g = Number(svG.value.replace(",", "."));
  const n = svName.value.trim().toLowerCase();
  if (!f || !n || !g) return;
  addServing(f.id, n, g);
  svOpen.value = false; svG.value = "";
  unit.value = n; grams.value = "1"; fresh = true;
  toast(`Saved 1 ${n} = ${g} g for ${f.name} · only you see it`);
}
function dropServing(u: UnitOpt) {
  const f = detail.value;
  if (!f) return;
  removeServing(f.id, u.unit);
  if (unit.value === u.unit) setUnit(units.value[0]);
  toast(`Removed serving “${u.unit}”`, { label: "Undo", run: () => addServing(f.id, u.unit, u.g) });
}
function typeInto(cur: string, k: string, maxInt = 4): string {
  if (k === "⌫") return cur.length <= 1 ? "0" : cur.slice(0, -1);
  if (k === ".") return cur.includes(".") ? cur : cur + ".";
  if (cur.includes(".") && cur.split(".")[1].length >= 1) return cur;
  if (!cur.includes(".") && cur.replace(/^0/, "").length >= maxInt) return cur;
  return cur === "0" ? k : cur + k;
}
function gramsKey(k: string) {
  if (fresh && k !== ".") { grams.value = k === "⌫" ? "0" : k; fresh = false; return; }
  fresh = false;
  grams.value = typeInto(grams.value, k);
}
function gramsInput(e: Event) {
  const el = e.target as HTMLInputElement;
  let v = el.value.replace(",", ".").replace(/[^0-9.]/g, "");
  const [a, b] = v.split(".");
  v = b === undefined ? a.slice(0, 4) : `${a.slice(0, 4)}.${b.slice(0, isServing.value ? 2 : 1)}`;
  grams.value = v === "" ? "" : v;
  el.value = grams.value;
}
function qInput(k: QF, e: Event) {
  const el = e.target as HTMLInputElement;
  const v = el.value.replace(",", ".").replace(/[^0-9.]/g, "").slice(0, k === "kcal" ? 5 : 4);
  qa.value[k] = v; el.value = v;
}
/** Day totals after this add (desktop shows it in the spare space). */
const after = computed(() => {
  const t = dayTotals(ui.date);
  const g = targetFor(ui.date);
  if (!g) return null;
  const old = ui.editEntry ?? { kcal: 0, p: 0, f: 0, c: 0 };
  const a = preview.value;
  return [
    { k: "kcal", label: "Calories", v: t.kcal - old.kcal + a.kcal, tgt: g.kcal, unit: "kcal" },
    { k: "p", label: "Protein", v: t.p - old.p + a.p, tgt: g.p, unit: "g" },
    { k: "f", label: "Fat", v: t.f - old.f + a.f, tgt: g.f, unit: "g" },
    { k: "c", label: "Carbs", v: t.c - old.c + a.c, tgt: g.c, unit: "g" },
  ] as const;
});
function setGrams(g: number) { grams.value = String(g); fresh = false; }
function addDetail() {
  const f = detail.value!;
  const a = gramsNum.value, g = gEq.value;
  if (!a) return;
  guardSave(() => {
    if (ui.editEntry) {
      // keep the entry's own snapshot: editing an amount never re-prices it with today's food values
      updateEntry(ui.editEntry.id, { amount: a, unit: unit.value, grams: r1(g), per100: values.value, time: ui.time ?? ui.editEntry.time, ...macrosOf(values.value, g) });
      toast(`Updated ${f.name} · ${preview.value.kcal} kcal`);
      closeSheet();
    } else {
      added(addEntry({ date: ui.date, time: entryTime(), ...entryFor(f, a, unit.value, g) }));
      toast(`Added ${amountLabel(a, unit.value)} ${f.name} · ${preview.value.kcal} kcal${dayNote.value}`);
      // Back to the list so several foods can be logged together (and saved as a group).
      ui.detailFoodId = null; q.value = "";
    }
  });
}
function deleteEdited() {
  const e = ui.editEntry;
  if (!e) return;
  const removed = removeEntries([e.id]);
  toast(`Deleted ${e.name}`, { label: "Undo", run: () => restoreEntries(removed) });
  closeSheet();
}
/** S5: every swipe/hover action has a visible button — Copy to… lives in the edit sheet too */
function copyEdited() {
  const e = ui.editEntry;
  if (!e) return;
  ui.selected = [e.id];
  openCopy(true);
}
function back() {
  if (ui.foodEditor) { const ret = ui.foodEditor.ret; ui.foodEditor = null; if (ret !== "detail") ui.detailFoodId = null; return; }
  if (ui.editEntry) return closeSheet();
  ui.detailFoodId = null;
}

// ---------- My foods (S3) ----------
function newFood(seedName?: string) { ui.foodEditor = { seed: seedName ? { name: seedName } : undefined, ret: "list" }; }
function editFood(f: Food, from: "list" | "detail" = "list") { ui.foodEditor = { id: f.id, ret: from }; }
function onSaved(f: Food, created: boolean) {
  const ret = ui.foodEditor?.ret;
  ui.foodEditor = null;
  if (created) { toast(`Saved ${f.name} to My foods`); openDetail(f, usualOf(f).amount, usualOf(f).unit); }
  else { toast(`Updated ${f.name} · past entries unchanged`); if (ret === "detail" && !ui.editEntry) openDetail(f, usualOf(f).amount, usualOf(f).unit); else if (ret !== "detail") ui.detailFoodId = null; }
}
function onDeleted(f: Food) {
  ui.foodEditor = null; ui.detailFoodId = null;
  toast(`Deleted ${f.name} · past entries kept`, { label: "Undo", run: () => updateFood(f.id, { deleted: false }) });
}

// ---------- Quick Add ----------
type QF = "kcal" | "p" | "f" | "c";
const qa = ref<Record<QF, string>>({ kcal: "", p: "", f: "", c: "" });
const qName = ref("");
const active = ref<QF>("kcal");
const qFields: { key: QF; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "p", label: "Protein", unit: "g" },
  { key: "f", label: "Fat", unit: "g" },
  { key: "c", label: "Carbs", unit: "g" },
];
const qNum = (k: QF) => Number(qa.value[k]) || 0;
const qKcalAuto = computed(() => Math.round(kcalFromMacros(qNum("p"), qNum("f"), qNum("c"))));
const qKcal = computed(() => (qa.value.kcal !== "" ? Math.round(qNum("kcal")) : qKcalAuto.value));
function qKey(k: string) {
  const cur = qa.value[active.value];
  qa.value[active.value] = k === "⌫" ? cur.slice(0, -1) : typeInto(cur === "" ? "0" : cur, k, active.value === "kcal" ? 4 : 3);
  if (qa.value[active.value] === "0" && k === "⌫") qa.value[active.value] = "";
}
/** Quick Add → also save as one of my foods (per serving, no weight). Needs a name. */
const qSave = ref(false);
const qSaveNeedsName = computed(() => qSave.value && !qName.value.trim());
function addQuick() {
  if (!qKcal.value || qSaveNeedsName.value) return;
  const name = qName.value.trim() || "Quick add";
  const vals = { kcal: qKcal.value, p: Math.round(qNum("p")), f: Math.round(qNum("f")), c: Math.round(qNum("c")) };
  if (qSave.value && !ui.editEntry) {
    guardSave(() => {
      const f = createFood({ name, ...vals, usual: 100, servings: [{ name: "serving", g: 100 }], servingOnly: true, usualUnit: "serving", usualAmount: 1 });
      added(addEntry({ date: ui.date, time: entryTime(), ...entryFor(f, 1, "serving", 100) }));
      toast(`Added ${name} · ${vals.kcal} kcal · saved to My foods`, { label: "Edit food", run: () => { ui.sheet = "food"; editFood(f); } });
      qName.value = ""; qa.value = { kcal: "", p: "", f: "", c: "" }; active.value = "kcal"; qSave.value = false;
      ui.foodTab = "search";
    });
    return;
  }
  guardSave(() => {
    if (ui.editEntry) {
      updateEntry(ui.editEntry.id, { name, time: ui.time ?? ui.editEntry.time, ...vals });
      toast(`Updated ${name} · ${vals.kcal} kcal`);
      closeSheet();
    } else {
      added(addEntry({ date: ui.date, time: entryTime(), name, ...vals }));
      toast(`Added ${name} · ${vals.kcal} kcal${dayNote.value}`);
      qName.value = ""; qa.value = { kcal: "", p: "", f: "", c: "" }; active.value = "kcal";
      ui.foodTab = "search";
    }
  });
}

// Reset when (re)opened
watch(open, (o) => {
  if (!o) return;
  q.value = ""; hi.value = 0; saveError.value = false; openGroup.value = null; pending = null; askTime.value = false; qSave.value = false;
  qName.value = ""; qa.value = { kcal: "", p: "", f: "", c: "" }; active.value = "kcal";
  const e = ui.editEntry;
  if (e?.foodId && findFood(e.foodId)) openDetail(findFood(e.foodId)!, e.amount ?? e.grams ?? 100, e.unit ?? "g");
  else if (e) {
    qName.value = e.name === "Quick add" ? "" : e.name;
    qa.value = { kcal: String(e.kcal), p: String(e.p), f: String(e.f), c: String(e.c) };
  }
});
const sheetLabel = computed(() => (ui.foodEditor ? (ui.foodEditor.id ? "Edit my food" : "New food") : ui.editEntry ? "Edit food" : "Add food"));
defineExpose({ openDetail });
</script>

<template>
  <BottomSheet :open="open" :label="sheetLabel" @close="closeSheet">
    <template #header>
      <div class="row hdr">
        <CircleBtn v-if="detail || ui.foodEditor" icon="left" label="Back" @click="back" />
        <h2 v-else class="t-head">{{ ui.editEntry ? "Edit food" : "Add food" }}</h2>
        <span class="grow" />
        <TimeChip v-if="!ui.foodEditor" ref="chip" v-model="time" :date="ui.date" :allow-now="!ui.editEntry" />
        <CircleBtn icon="x" label="Close" @click="closeSheet" />
      </div>
      <p v-if="needTime && !ui.foodEditor" class="needt t-label" :class="{ ask: askTime }" role="status">
        <Icon name="clock" :size="14" :sw="2.2" /> Logging to {{ dayMonth(ui.date) }} — pick the time you ate it{{ askTime ? " to finish adding" : "" }}.
      </p>
      <Segmented v-if="!detail && !ui.editEntry && !ui.foodEditor" v-model="tab" :options="[{ value: 'search', label: 'Search' }, { value: 'quick', label: 'Quick Add' }]" />
    </template>

    <!-- My food editor (S3) -->
    <div v-if="ui.foodEditor" class="list">
      <FoodEditor :key="ui.foodEditor.id ?? 'new'" :edit-id="ui.foodEditor.id" :seed="ui.foodEditor.seed" @saved="onSaved" @deleted="onDeleted" @cancel="back" />
    </div>

    <!-- Food detail -->
    <template v-else-if="detail">
      <div class="col center gap2">
        <h3 class="t-head dname">{{ detail.name }}</h3>
        <span class="row gap6 t-label c2 wrapc"><span v-if="detail.mine" class="mine t-capn"><Icon name="lock" :size="10" :sw="2.4" /> my food</span><span v-if="detail.brand">{{ detail.brand }} ·</span><span>{{ per100 }}</span>
          <button v-if="detail.mine && !ui.editEntry" type="button" class="linkbtn t-label" @click="editFood(detail, 'detail')">Edit</button></span>
        <span v-if="ui.editEntry && snapDiffers" class="t-capn c2">Using the values it was logged with — this food has changed since.</span>
      </div>
      <div class="col center gap8" style="padding-top: 2px">
        <div v-if="keyboardEntry" class="base">
          <span class="autosize t-dl">
            <span class="mirror" aria-hidden="true">{{ grams || "0" }}</span>
            <input ref="gramsEl" :value="grams" class="t-dl num ginput" size="1" inputmode="decimal" autocomplete="off" :aria-label="`Amount in ${unit}`"
              @input="gramsInput" @keydown.enter.prevent="addDetail" />
          </span>
          <span class="t-head c2">{{ amountLabel(gramsNum, unit).replace(/^[\d.]+ /, "") }}</span>
        </div>
        <div v-else class="base" role="status" :aria-label="`${amountLabel(gramsNum, unit)}`">
          <span class="t-dl num">{{ grams }}</span><span class="caret" style="height: 40px" /><span class="t-head c2">{{ amountLabel(gramsNum, unit).replace(/^[\d.]+ /, "") }}</span>
        </div>
        <!-- live gram equivalent (S2) -->
        <span v-if="isServing && !detail.servingOnly" class="t-label c2 geq" aria-live="polite">= {{ int(gEq) }} g <span class="c2">· 1 {{ unit }} = {{ r1(unitG) }} g</span></span>
        <div class="row units" role="radiogroup" aria-label="Unit">
          <button v-for="u in units" :key="u.unit" type="button" role="radio" class="uchip t-label" :class="{ on: u.unit === unit }" :aria-checked="u.unit === unit" @click="setUnit(u)">
            {{ u.unit }}<span v-if="u.unit !== 'g' && u.unit !== 'ml' && !detail.servingOnly" class="ug"> · {{ r1(u.g) }} g</span><span v-if="u.mine && !detail.mine" class="sr-only"> (your serving)</span>
          </button>
          <button v-if="!detail.servingOnly" type="button" class="uchip add t-label" :aria-expanded="svOpen" @click="svOpen = !svOpen"><Icon name="plus" :size="14" :sw="2.4" /> Serving</button>
        </div>
        <div v-if="svOpen" class="svform col">
          <div class="row gap8">
            <span class="t-label">1</span>
            <input v-model="svName" class="sinp t-body" type="text" aria-label="Serving name" placeholder="slice" />
            <span class="t-label">=</span>
            <input v-model="svG" class="sinp t-body num" inputmode="decimal" aria-label="Grams in one serving" placeholder="35" style="width: 72px" @keydown.enter.prevent="saveServing" />
            <span class="t-label c2">g</span>
            <button type="button" class="chip on t-label" :disabled="!svName.trim() || !Number(svG.replace(',', '.'))" @click="saveServing">Save</button>
          </div>
          <div class="row gap8 wrapc">
            <span class="t-capn c2"><Icon name="lock" :size="10" :sw="2.4" /> Private — only you see your servings.</span>
            <button v-for="u in units.filter((x) => x.mine && !detail?.mine)" :key="'d' + u.unit" type="button" class="linkbtn t-capn" :aria-label="`Remove serving ${u.unit}`" @click="dropServing(u)">Remove “{{ u.unit }}”</button>
          </div>
        </div>
        <div v-else class="row gap8">
          <button v-for="g in quickAmounts" :key="g" type="button" class="chip t-label small" @click="setGrams(g)">{{ amountLabel(g, unit) }}</button>
        </div>
      </div>
      <div class="preview">
        <div v-for="[n, l] in [[preview.kcal, 'KCAL'], [preview.p, 'PROTEIN'], [preview.f, 'FAT'], [preview.c, 'CARBS']]" :key="l" class="col center gap2">
          <span class="t-nm num">{{ int(Number(n)) }}</span><span class="t-cap c2">{{ l }}</span>
        </div>
      </div>
      <div v-if="keyboardEntry && after" class="after col">
        <div class="row"><span class="t-cap c3">{{ ui.date === today ? "Today" : "That day" }} after {{ ui.editEntry ? "saving" : "adding" }}</span><span class="grow" />
          <span class="t-capn c3">{{ after[0].v <= after[0].tgt ? `${int(after[0].tgt - after[0].v)} kcal left` : `${int(after[0].v - after[0].tgt)} kcal over` }}</span></div>
        <div v-for="m in after" :key="m.label" class="col arow">
          <div class="row"><span class="t-label c2 grow">{{ m.label }}</span><span class="t-bodys">{{ int(m.v) }}</span><span class="t-label c3">&nbsp;/ {{ int(m.tgt) }} {{ m.unit }}</span></div>
          <Bar :pct="m.v / m.tgt" :hit="macroStatus(m.k, m.v, m.tgt) === 'hit'" :over="macroStatus(m.k, m.v, m.tgt) === 'over'" />
        </div>
      </div>
      <div class="grow" />
      <div v-if="saveError" class="err row" role="alert">
        <Icon name="alert" :size="18" class="c2" />
        <span class="col grow"><span class="t-bodys">Server unreachable</span><span class="t-label c2">Nothing was lost — your entry is still here. Try again in a moment.</span></span>
        <button type="button" class="chip" @click="saveError = false">Dismiss</button>
      </div>
      <Keypad v-if="!keyboardEntry" @key="gramsKey" />
      <p v-else class="t-capn c3 khint"><kbd>Enter</kbd> {{ ui.editEntry ? "save" : "add" }} · <kbd>Esc</kbd> {{ ui.editEntry ? "close" : "back to search" }}</p>
      <div class="row gap8 actions">
        <button v-if="ui.editEntry" type="button" class="del-btn t-bodys" @click="deleteEdited"><Icon name="trash" :size="16" /><span class="dl">Delete</span></button>
        <button v-if="ui.editEntry" type="button" class="del-btn t-bodys" @click="copyEdited"><Icon name="copy" :size="16" /><span class="dl">Copy to…</span></button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="!gramsNum" @click="addDetail">
          {{ saveError ? "Try again" : addLabel }} · {{ int(preview.kcal) }} kcal
        </button>
      </div>
    </template>

    <!-- Search -->
    <template v-else-if="tab === 'search'">
      <label class="field row">
        <Icon name="search" :size="18" class="c2" />
        <input ref="searchEl" v-model="q" class="t-body grow" type="search" @keydown="searchKey" :placeholder="filter === 'mine' ? 'Search my foods' : 'Search foods'" aria-label="Search foods" autocomplete="off" enterkeyhint="search" />
        <button v-if="q" type="button" class="clr c2" aria-label="Clear search" @click="q = ''"><Icon name="x" :size="16" /></button>
      </label>
      <div class="row fchips" role="group" aria-label="Show">
        <button type="button" class="chip t-label small" :class="{ on: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">All foods</button>
        <button type="button" class="chip t-label small" :class="{ on: filter === 'mine' }" :aria-pressed="filter === 'mine'" @click="filter = 'mine'">My foods · {{ myFoods.length }}</button>
        <span class="grow" />
        <button type="button" class="chip t-label small" @click="newFood(filter === 'all' ? q.trim() : undefined)"><Icon name="plus" :size="14" :sw="2.4" />&nbsp;New food</button>
      </div>
      <div class="list">
        <!-- My foods filter (S3) -->
        <template v-if="filter === 'mine'">
          <div v-if="!myFoods.length" class="col emptyc">
            <span class="t-bodys">No foods of your own yet</span>
            <span class="t-label c2">Create one for a home recipe or anything the database doesn't have. Only you see them.</span>
            <button type="button" class="chip on t-label" style="align-self: flex-start; margin-top: 6px" @click="newFood()"><Icon name="plus" :size="14" :sw="2.4" />&nbsp;Create a food</button>
          </div>
          <div v-for="(r, i) in results" :key="r.food.id" class="rrow row" :class="{ hl: keyboardEntry && i === hi }" @mouseenter="hi = i">
            <button type="button" class="col grow rtext" @click="openDetail(r.food, r.amount, r.unit)">
              <span class="t-body ell">{{ r.food.name }}</span>
              <span class="t-label c2 ell">{{ r.food.brand ? r.food.brand + " · " : "" }}{{ rowSub(r) }}</span>
            </button>
            <button type="button" class="ibtn44" :aria-label="`Edit ${r.food.name}`" @click="editFood(r.food)"><Icon name="edit" :size="17" /></button>
            <CircleBtn :icon="justAdded === r.food.id ? 'check' : 'plus'" filled :label="`Add ${amountLabel(r.amount, r.unit)} ${r.food.name}`" @click="quickPlus(r)" />
          </div>
          <p v-if="myFoods.length && !results.length" class="t-label c2 empty">No match in my foods.</p>
        </template>
        <template v-else>
        <!-- Saved groups: re-log several foods in one tap -->
        <template v-if="groups.length">
          <div class="row lhead"><span class="t-cap c3">Saved groups</span><span class="grow" /><span class="t-capn c3">+ adds every item{{ needTime ? " at the time you pick" : ui.time || ui.date !== today ? ` at ${ui.time}` : " now" }}</span></div>
          <div v-for="g in groups" :key="g.id" class="grow-row col">
            <div class="rrow row grp">
              <span class="gic"><Icon name="layers" :size="16" /></span>
              <button type="button" class="col grow rtext" :aria-expanded="openGroup === g.id" @click="openGroup = openGroup === g.id ? null : g.id">
                <span class="t-body ell">{{ g.name }}</span>
                <span class="t-label c2 gsum"><span class="gnum">{{ g.items.length }} items · {{ int(groupKcal(g)) }} kcal</span><span class="ell gnames"> · {{ g.items.map((i) => i.name.split(",")[0]).join(", ") }}</span></span>
              </button>
              <button v-if="keyboardEntry" type="button" class="hdel" :aria-label="`Delete group ${g.name}`" title="Delete group" @click="removeGroup(g)"><Icon name="trash" :size="15" /></button>
              <button v-else type="button" class="ibtn44" :aria-label="openGroup === g.id ? `Hide items in ${g.name}` : `Show items in ${g.name}`" :aria-expanded="openGroup === g.id" @click="openGroup = openGroup === g.id ? null : g.id"><Icon name="down" :size="16" :class="{ flip: openGroup === g.id }" /></button>
              <CircleBtn :icon="justGroup === g.id ? 'check' : 'plus'" filled :label="`Add group ${g.name}`" @click="addGroup(g)" />
            </div>
            <div v-if="openGroup === g.id" class="gitems col">
              <div v-for="(it, j) in g.items" :key="j" class="row gi"><span class="t-label grow ell">{{ it.name }}</span><span class="t-label c2">{{ it.unit ? amountLabel(it.amount ?? 0, it.unit) + " · " : it.grams ? it.grams + " g · " : "" }}{{ it.kcal }} kcal</span></div>
              <button type="button" class="t-label c2 gdel" @click="removeGroup(g)"><Icon name="trash" :size="14" /> Delete group</button>
            </div>
          </div>
        </template>
        <div class="row lhead">
          <span class="t-cap c2">{{ q ? (offline || ui.demo === "loading" ? "Foods you've used" : "Results") : "Recent" }}</span><span class="grow" />
          <span class="t-capn c2">{{ keyboardEntry ? "↑↓ choose · Enter amount · Shift+Enter last amount" : "+ adds your last amount" }}</span>
        </div>
        <div v-for="(r, i) in results" :key="r.food.id" class="rrow row" :class="{ hl: keyboardEntry && i === hi }" @mouseenter="hi = i">
          <button type="button" class="col grow rtext" @click="openDetail(r.food, r.amount, r.unit)">
            <span class="row gap6 nm"><span class="t-body ell">{{ r.food.name }}</span><span v-if="r.food.mine" class="mine t-capn">my food</span></span>
            <span class="t-label c2 ell">{{ r.food.brand ? r.food.brand + " · " : "" }}{{ rowSub(r) }}</span>
          </button>
          <CircleBtn :icon="justAdded === r.food.id ? 'check' : 'plus'" filled :label="`Add ${amountLabel(r.amount, r.unit)} ${r.food.name}`" @click="quickPlus(r)" />
        </div>
        <!-- Loading demo: local results first, then skeletons while the outside database answers -->
        <div v-if="q && (ui.demo === 'loading' || retrying)" class="col skl" aria-live="polite">
          <span class="t-capn c3">Searching Open Food Facts…</span>
          <div v-for="i in 3" :key="i" class="row skrow"><div class="col grow" style="gap: 6px"><Skeleton w="60%" /><Skeleton w="40%" :h="10" /></div><Skeleton w="32px" :h="32" :r="16" /></div>
        </div>
        <!-- Error demo: Open Food Facts down / rate-limited -->
        <div v-else-if="q && offline" class="err col" role="alert">
          <div class="row" style="gap: 10px"><Icon name="alert" :size="18" class="c2" /><span class="t-bodys">Can't reach the food database</span></div>
          <span class="t-label c2">Showing foods you've used before. Packaged foods need the online database.</span>
          <div class="row gap8">
            <button type="button" class="chip on" @click="retrySearch"><Icon name="refresh" :size="14" />&nbsp;Try again</button>
            <button type="button" class="chip" @click="tab = 'quick'">Quick Add instead</button>
          </div>
        </div>
        <div v-else-if="!results.length && q" class="col emptyc">
          <span class="t-label c2">No match for “{{ q }}”.</span>
          <div class="row gap8"><button type="button" class="chip t-label small" @click="newFood(q.trim())"><Icon name="plus" :size="14" :sw="2.4" />&nbsp;Create “{{ q.trim() }}”</button><button type="button" class="chip t-label small" @click="tab = 'quick'">Quick Add</button></div>
        </div>
        <div v-else-if="!results.length && !groups.length" class="col emptyc">
          <span class="t-bodys">Nothing here yet</span>
          <span class="t-label c2">Search for a food above. Foods you log show up here with your last amount, so next time it's one tap.</span>
        </div>
        </template>
      </div>
      <!-- Session bar: what was added since the sheet opened -->
      <div v-if="sessionEntries.length && !ui.editEntry" class="session" role="status">
        <span class="col stext"><span class="t-bodys">{{ sessionEntries.length }} added · {{ int(sessionKcal) }} kcal</span>
          <span class="t-capn c2 ell">{{ sessionEntries.map((e) => e.name.split(",")[0]).join(", ") }}</span></span>
        <span class="row sbtns">
          <button v-if="sessionEntries.length > 1" type="button" class="chip" @click="openGroupSheet(sessionEntries)"><Icon name="layers" :size="14" />&nbsp;Save as group</button>
          <button type="button" class="chip on" @click="closeSheet">Done</button>
        </span>
      </div>
    </template>

    <!-- Quick Add -->
    <template v-else>
      <label class="field row">
        <input ref="qNameEl" v-model="qName" class="t-body grow" type="text" @keydown.enter.prevent="keyboardEntry && addQuick()" placeholder="Protein bar" aria-label="Name (optional)" autocomplete="off" enterkeyhint="done" />
        <span class="t-capn c2">{{ qSave ? "name · needed" : "name · optional" }}</span>
      </label>
      <div class="qgrid">
        <template v-if="keyboardEntry">
        <label v-for="f in qFields" :key="'k' + f.key" class="qf" :class="{ on: active === f.key }">
          <span class="t-capm c2">{{ f.label }}</span>
          <span class="base">
            <span class="autosize t-nm">
              <span class="mirror" aria-hidden="true">{{ qa[f.key] || (f.key === 'kcal' && qKcalAuto ? String(qKcalAuto) : '0') }}</span>
              <input :value="qa[f.key]" class="t-nm num qinput" size="1" inputmode="decimal" autocomplete="off" :aria-label="f.label"
                :placeholder="f.key === 'kcal' && qKcalAuto ? String(qKcalAuto) : '0'"
                @input="qInput(f.key, $event)" @focus="active = f.key" @keydown.enter.prevent="addQuick" />
            </span>
            <span class="t-label c2">{{ f.unit }}</span>
          </span>
        </label>
        </template>
        <template v-else>
        <button v-for="f in qFields" :key="f.key" type="button" class="qf" :class="{ on: active === f.key }" @click="active = f.key">
          <span class="t-capm c2">{{ f.label }}</span>
          <span class="base">
            <span v-if="f.key === 'kcal' && qa.kcal === '' && qKcalAuto" class="t-nm num c3">{{ qKcalAuto }}</span>
            <span v-else-if="qa[f.key] === ''" class="t-nm num c3">0</span>
            <span v-else class="t-nm num">{{ qa[f.key] }}</span>
            <span v-if="active === f.key" class="caret" style="height: 26px" />
            <span class="t-label c2">{{ f.unit }}</span>
          </span>
        </button>
        </template>
      </div>
      <p class="t-capn c2 note">Leave kcal empty and it is worked out from P · F · C (4 · 9 · 4 kcal/g).</p>
      <label v-if="!ui.editEntry" class="qsave row">
        <input v-model="qSave" type="checkbox" />
        <span class="col"><span class="t-label">Also save as my food</span><span class="t-capn" :class="qSaveNeedsName ? '' : 'c2'">{{ qSaveNeedsName ? "! Add a name above to save it" : "One tap next time · saved per serving · private" }}</span></span>
      </label>
      <button v-else type="button" class="linkbtn t-label" style="align-self: flex-start" @click="ui.foodEditor = { seed: { name: qName, kcal: qKcal, p: qNum('p'), f: qNum('f'), c: qNum('c') }, ret: 'list' }">Save as my food…</button>
      <div class="grow" />
      <div v-if="saveError" class="err row" role="alert">
        <Icon name="alert" :size="18" class="c2" />
        <span class="col grow"><span class="t-bodys">Server unreachable</span><span class="t-label c2">Nothing was lost — your entry is still here. Try again in a moment.</span></span>
        <button type="button" class="chip" @click="saveError = false">Dismiss</button>
      </div>
      <Keypad v-if="!keyboardEntry" @key="qKey" />
      <p v-else class="t-capn c3 khint"><kbd>Tab</kbd> next field · <kbd>Enter</kbd> {{ ui.editEntry ? "save" : "add" }} · <kbd>Esc</kbd> close</p>
      <div class="row gap8 actions">
        <button v-if="ui.editEntry" type="button" class="del-btn t-bodys" @click="deleteEdited"><Icon name="trash" :size="16" /><span class="dl">Delete</span></button>
        <button v-if="ui.editEntry" type="button" class="del-btn t-bodys" @click="copyEdited"><Icon name="copy" :size="16" /><span class="dl">Copy to…</span></button>
        <button type="button" class="primary-btn t-bodys grow" :disabled="!qKcal || qSaveNeedsName" @click="addQuick">
          {{ saveError ? "Try again" : addLabel }} · {{ int(qKcal) }} kcal
        </button>
      </div>
    </template>
  </BottomSheet>
</template>

<style scoped>
.hdr { gap: 8px; }
.center { align-items: center; text-align: center; }
.gap2 { gap: 2px; }
.gap8 { gap: 8px; }
.row.gap8 { gap: 8px; }
.chip.small { min-height: 28px; border-radius: 14px; }
.caret { width: 2px; background: var(--color-action); align-self: center; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.preview { display: flex; justify-content: space-around; padding: 14px 0; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.field { min-height: 44px; padding: 0 12px; gap: 8px; border-radius: var(--radius-control); background: var(--color-surface-2); flex: none; }
.field input { border: 0; outline: 0; background: transparent; min-width: 0; padding: 0; -webkit-appearance: none; appearance: none; }
.field input::placeholder { color: var(--text-tertiary); }
.field input::-webkit-search-cancel-button { display: none; }
.list { flex: 1 1 auto; overflow-y: auto; margin: 0 -16px; padding: 0 16px; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.rrow { min-height: 56px; padding: 6px 0; gap: 12px; border-bottom: 1px solid var(--color-border); }
.rtext { text-align: left; gap: 2px; min-width: 0; align-items: flex-start; }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.empty { padding: 16px 0; margin: 0; }
.qgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: none; }
.qf { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 13px 14px; border-radius: var(--radius-control); background: var(--color-surface-2); box-shadow: inset 0 0 0 0 transparent; text-align: left; }
.qf.on { box-shadow: inset 0 0 0 1.5px var(--color-action); }
.note { margin: 0; }
.rrow.hl { background: var(--color-surface-2); margin: 0 -12px; padding: 0 12px; border-radius: 12px; border-bottom-color: transparent; }
.can-hover .rtext:hover .t-body { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--text-tertiary); }
.autosize { display: inline-grid; }
.autosize > * { grid-area: 1 / 1; }
.mirror { visibility: hidden; white-space: pre; padding-right: 2px; }
.ginput, .qinput { width: 0; min-width: 100%; background: transparent; border: 0; outline: 0; padding: 0; margin: 0; caret-color: #fff; color: #fff; -webkit-appearance: none; appearance: none; }
.qinput::placeholder { color: var(--text-tertiary); }
.qf:focus-within { box-shadow: inset 0 0 0 1.5px var(--color-action); }
label.qf { cursor: text; }
.khint { text-align: center; margin: 0 0 4px; }
.needt { margin: 0; display: flex; align-items: center; gap: 6px; color: var(--text-secondary); }
.needt.ask { color: var(--text-primary); }
.lhead { padding: 10px 0 2px; }
.grp { gap: 10px; }
.gic { width: 32px; height: 32px; border-radius: 10px; background: var(--color-surface-2); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; }
.gitems { padding: 4px 0 10px 42px; gap: 6px; border-bottom: 1px solid var(--color-border); }
.gi { gap: 8px; }
.gdel { align-self: flex-start; padding: 6px 0; text-decoration: underline; text-underline-offset: 3px; }
.hdel { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); opacity: 0; }
.grp:hover .hdel, .hdel:focus-visible { opacity: 1; }
.hdel:hover { background: var(--color-surface-2); color: #fff; }
.skl { gap: 10px; padding: 12px 0; }
.skrow { gap: 12px; height: 44px; }
.err { gap: 10px; padding: 14px; margin: 12px 0; border-radius: var(--radius-card); border: 1px dashed var(--text-tertiary); flex: none; }
.err.row { gap: 12px; margin: 0; }
.chip { gap: 0; }
.emptyc { gap: 6px; padding: 20px 0; }
/* Session bar: text gets the room it needs; buttons drop to their own row on narrow phones (fixes "3 added · 35…") */
.session { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px; border-radius: var(--radius-card); background: var(--color-surface-2); flex: none; }
.stext { flex: 1 1 150px; min-width: 0; }
.sbtns { gap: 8px; flex: 0 0 auto; margin-left: auto; }
.session .t-bodys { white-space: nowrap; }
.session .chip { white-space: nowrap; flex: none; background: #303036; color: #fff; height: 40px; padding: 0 14px; border-radius: 20px; }
.session .chip.on { background: var(--color-action); color: var(--color-on-action); }
.actions { flex: none; }
.actions .primary-btn { width: auto; flex: 1 1 auto; min-width: 0; }
.del-btn { height: 52px; padding: 0 18px; border-radius: 26px; background: var(--color-surface-2); color: var(--text-primary); display: inline-flex; align-items: center; gap: 8px; flex: none; }
@media (max-width: 420px) { .actions .del-btn { padding: 0 15px; } .actions .del-btn .dl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; } }
.can-hover .del-btn:hover { background: #303036; }
.after { gap: 12px; padding: 16px; border-radius: var(--radius-card); border: 1px solid var(--color-border); }
.arow { gap: 6px; }
.gap6 { gap: 6px; }
.row.gap6 { gap: 6px; }
.wrapc { flex-wrap: wrap; justify-content: center; }
.dname { margin: 0; text-align: center; }
.mine { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--color-border-strong, #4a4a52); color: var(--text-secondary); white-space: nowrap; flex: none; }
.nm { min-width: 0; max-width: 100%; }
.linkbtn { color: var(--text-primary); text-decoration: underline; text-underline-offset: 3px; padding: 10px 2px; margin: -10px 0; }
.geq { margin-top: -6px; }
.units { gap: 6px; flex-wrap: nowrap; overflow-x: auto; max-width: 100%; padding: 2px; scrollbar-width: none; }
.uchip { min-width: 44px; justify-content: center; height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--color-border-strong, #4a4a52); white-space: nowrap; flex: none; display: inline-flex; align-items: center; gap: 2px; position: relative; color: var(--text-primary); }
.uchip::after { content: ""; position: absolute; inset: -4px 0; }
.uchip .ug { color: var(--text-secondary); }
.uchip.on { background: var(--color-action); color: var(--color-on-action); border-color: var(--color-action); }
.uchip.on .ug { color: #3a3a40; }
.uchip.add { border-style: dashed; color: var(--text-secondary); }
.svform { gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); align-items: center; }
.sinp { height: 40px; width: 110px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--color-border-strong, #4a4a52); background: var(--color-surface); color: #fff; }
.sinp:focus { outline: none; border-color: var(--color-action); }
.fchips { gap: 6px; flex: none; }
.chip.small.on { background: var(--color-action); color: var(--color-on-action); }
.ibtn44 { width: 44px; height: 44px; margin: 0 -6px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-secondary); flex: none; }
.ibtn44:hover { color: #fff; background: var(--color-surface-2); }
.flip { transform: rotate(180deg); }
.clr { width: 44px; height: 44px; margin-right: -12px; display: inline-flex; align-items: center; justify-content: center; }
.qsave { gap: 12px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: var(--color-surface-2); cursor: pointer; flex: none; }
.qsave input { width: 20px; height: 20px; margin: 1px 0 0; accent-color: #fff; flex: none; }
/* Dynamic Type: detail and Quick Add scroll as a whole at large sizes; unit/amount chips wrap; macro tiles 2 × 2 */
.dt-l .units { flex-wrap: wrap; overflow: visible; justify-content: center; }
.dt-l .uchip { height: auto; min-height: 44px; white-space: normal; }
.dt-xl .preview { display: grid; grid-template-columns: 1fr 1fr; row-gap: 12px; }
.dt-xl .qgrid { grid-template-columns: 1fr; }
/* numbers never truncate: only the food-name list can ellipsize (and wraps from xxLarge) */
.gsum { display: flex; min-width: 0; width: 100%; max-width: 100%; overflow: hidden; }
.gnames { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gnum { flex: none; white-space: nowrap; }
.gnames { min-width: 0; }
.dt-l .gsum { display: block; }
</style>
