// Local, in-memory app state for the prototype (no backend). Clearly fictional example data.
// Reactive so totals, targets, trend, calendar etc. update live; persisted to localStorage.
import { computed, reactive, watch } from "vue";
import { addDays, range, DEMO_TODAY, parse, diffDays } from "./lib/dates";
import { targets as calcTargets, type Profile, type Targets } from "./lib/nutrition";
import { CLUSTER_GAP_MIN, toMin } from "./lib/time";
import { SEED_PROFILE, seedEntries, seedGroups, seedWeights, seedMyFoods } from "./data/seed";
import { FOODS, amountLabel, type Food, type Serving } from "./data/foods";

export interface Entry {
  id: string;
  date: string; // local calendar day
  time: string; // local "HH:MM"
  foodId?: string; // undefined = Quick Add
  name: string;
  /** gram equivalent (1 ml counted as 1 g for liquids) */
  grams?: number;
  /** what was typed, in its unit: 2 × "piece", 250 × "ml", 180 × "g" (S2) */
  amount?: number;
  unit?: string;
  /** per-100 g snapshot of the food at logging time: editing the food never changes this entry (S3) */
  per100?: { kcal: number; p: number; f: number; c: number };
  kcal: number;
  p: number;
  f: number;
  c: number;
}
export type GroupItem = Omit<Entry, "id" | "date" | "time">;

/** One row of target_history (S1). A day uses the last row dated on or before it. */
export type TargetReason = "setup" | "weekly" | "profile" | "goal" | "macro" | "mode_switch" | "manual_changed";
export interface TargetRow {
  id: string;
  date: string;
  reason: TargetReason;
  /** e.g. "Rate 0.75 → 0.5 kg/week" */
  note: string;
  /** which field changed (used to merge repeated taps on the same control) */
  field?: string;
  /** approved 24 Oct: several changes on one day merge into one row — latest values, every reason listed */
  reasons?: TargetReason[];
  /** per-field changes merged into this row (from = value before the first change that day) */
  changes?: { field: string; reason: TargetReason; from: unknown; to: unknown }[];
  weight: number;
  bmr: number;
  tdee: number;
  kcal: number;
  p: number;
  f: number;
  c: number;
  floored: boolean;
  /** S7: goal mode that applied; manual rows never apply the floor, they flag below-BMR instead */
  mode?: "rate" | "manual";
  belowBmr?: boolean;
  fatCut?: boolean;
}
export const REASON_LABEL: Record<TargetReason, string> = { setup: "First setup", weekly: "Weekly update", profile: "Profile change", goal: "Goal change", macro: "Macro balance change", mode_switch: "Goal mode switch", manual_changed: "Own number changed" };
/** All reasons of a (possibly merged) row, e.g. "Goal change · Macro balance change". */
export const reasonText = (r: TargetRow) => [...new Set(r.reasons?.length ? r.reasons : [r.reason])].map((x) => REASON_LABEL[x]).join(" · ");
export interface SavedGroup { id: string; name: string; items: GroupItem[] }
export interface Totals { kcal: number; p: number; f: number; c: number }

interface State {
  version: number;
  onboarded: boolean;
  profile: Profile;
  weights: Record<string, number>;
  entries: Entry[];
  groups: SavedGroup[];
  lastUsed: Record<string, { at: number; grams: number; amount?: number; unit?: string }>; // foodId -> recency + last amount/unit
  complete: Record<string, boolean>; // "day complete" flags (decision 3)
  history: TargetRow[]; // target_history, oldest first (S1)
  myFoods: Food[]; // custom foods, private (S3)
  servings: Record<string, Serving[]>; // private servings added to any food (S2)
  /** goal-reached question answered "keep" for this goal (key = mode|goal weight|number) */
  goalAnswered?: string;
}

const KEY = "gymbro-proto-v3";
const VERSION = 3;
export const today = DEMO_TODAY;

/**
 * Trend weight (decision 5): exponentially weighted — each weigh-in moves the trend a fixed share
 * (TREND_ALPHA) towards it; days without a weigh-in keep the trend. Approved 24 Oct 2026: 10 % per weigh-in
 * (spec decision 5). The fictional example weigh-ins are set so today's trend is 83.6 kg (worked example).
 */
export const TREND_ALPHA = 0.1;
function trendOf(weights: Record<string, number>, date: string): number | null {
  const ds = Object.keys(weights).filter((d) => d <= date).sort();
  if (!ds.length) return null;
  let t = weights[ds[0]];
  for (const d of ds.slice(1)) t += TREND_ALPHA * (weights[d] - t);
  return t;
}

let rowSeq = 0;
function makeRow(p: Profile, weights: Record<string, number>, date: string, reason: TargetReason, note: string, field?: string): TargetRow {
  const w = trendOf(weights, date) ?? p.startWeight;
  const t = calcTargets(p, w, parse(date).getFullYear());
  return { id: `t${++rowSeq}`, date, reason, note, field, weight: Math.round(w * 10) / 10, bmr: Math.round(t.bmr), tdee: Math.round(t.tdee),
    kcal: Math.round(t.kcal), p: Math.round(t.protein), f: Math.round(t.fat), c: Math.round(t.carbs), floored: t.floored,
    mode: t.manual ? "manual" : "rate", belowBmr: t.belowBmr, fatCut: t.fatCut };
}
/** Fictional target history: setup 19 Sep, Monday updates, a goal change, a macro change and today's goal-weight edit. */
function seedHistory(weights: Record<string, number>): TargetRow[] {
  const P = SEED_PROFILE;
  const v1 = { ...P, rate: 0.75, proteinPerKg: 1.6, goalWeight: 82 };
  const v2 = { ...v1, rate: 0.5 };
  const v3 = { ...v2, proteinPerKg: 2.0 };
  return [
    makeRow(v1, weights, "2026-09-19", "setup", "Profile set up · lose 0.75 kg/week"),
    makeRow(v1, weights, "2026-09-21", "weekly", "Trend weight updated"),
    makeRow(v1, weights, "2026-09-28", "weekly", "Trend weight updated"),
    makeRow(v1, weights, "2026-10-05", "weekly", "Trend weight updated"),
    makeRow(v2, weights, "2026-10-08", "goal", "Rate 0.75 → 0.5 kg/week", "rate"),
    makeRow(v2, weights, "2026-10-12", "weekly", "Trend weight updated"),
    makeRow(v3, weights, "2026-10-14", "macro", "Protein Less → Normal (1.6 → 2.0 g/kg)", "proteinPerKg"),
    makeRow(v3, weights, "2026-10-19", "weekly", "Trend weight updated"),
    { ...makeRow(P, weights, DEMO_TODAY, "goal", "Goal weight 82 → 80 kg", "goalWeight"), reasons: ["goal"], changes: [{ field: "goalWeight", reason: "goal", from: 82, to: 80 }] },
  ];
}
const rowFor = (rows: TargetRow[], date: string) => { let r: TargetRow | null = null; for (const x of rows) if (x.date <= date) r = x; return r; };

function seed(): State {
  const weights = seedWeights();
  const history = seedHistory(weights);
  const entries = seedEntries((d) => rowFor(history, d)?.kcal ?? history[0].kcal);
  const lastUsed: State["lastUsed"] = {};
  entries.forEach((e, i) => e.foodId && (lastUsed[e.foodId] = { at: i, grams: e.grams!, amount: e.amount, unit: e.unit }));
  // Figma "Recent" order: most recent first. Eggs/banana/whey remember a piece/scoop amount (S2).
  const usual: Record<string, [number, number, string]> = { chicken: [180, 180, "g"], rice: [200, 200, "g"], yogurt: [250, 250, "g"], salmon: [150, 150, "g"], eggs: [120, 2, "piece"], banana: [120, 1, "piece"], whey: [30, 1, "scoop"], oats: [60, 60, "g"] };
  ["oats", "whey", "banana", "eggs", "salmon", "yogurt", "rice", "chicken"].forEach((id, i) => { const [g, a, u] = usual[id]; lastUsed[id] = { at: 1e6 + i, grams: g, amount: a, unit: u }; });
  const myFoods = seedMyFoods();
  lastUsed[myFoods[0].id] = { at: 1e6 - 1, grams: 330, amount: 1, unit: "serving" };
  return { version: VERSION, onboarded: true, profile: { ...SEED_PROFILE }, weights, entries, groups: seedGroups(), lastUsed, complete: completeSeed(),
    history, myFoods, servings: { bread: [{ name: "thin slice", g: 30, mine: true }] } };
}

function completeSeed(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const d of range("2026-09-15", addDays(DEMO_TODAY, -1))) out[d] = true;
  return out;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.version === VERSION) return s;
    }
  } catch { /* private mode or bad JSON: fall back to seed */ }
  return seed();
}

export const state = reactive<State>(load());

watch(state, (s) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore quota/private mode */ }
}, { deep: true });

function replaceWith(s: State) {
  for (const k of Object.keys(state.profile)) if (!(k in s.profile)) delete (state.profile as unknown as Record<string, unknown>)[k];
  Object.assign(state.profile, s.profile); // keep object identity for views holding a reference
  state.onboarded = s.onboarded;
  state.weights = s.weights;
  state.entries = s.entries;
  state.groups = s.groups;
  state.lastUsed = s.lastUsed;
  state.complete = s.complete;
  state.history = s.history;
  state.myFoods = s.myFoods;
  state.servings = s.servings;
  state.goalAnswered = s.goalAnswered;
  syncProfileSnapshot();
}
/** Demo: full example data. */
export function resetDemo() { replaceWith(seed()); }
/** Demo: a signed-up account with a profile but nothing logged and no weigh-ins. */
export function emptyAccount() {
  const s = seed();
  replaceWith({ ...s, weights: {}, entries: [], groups: [], lastUsed: {}, complete: {}, myFoods: [], servings: {},
    history: [makeRow(s.profile, {}, DEMO_TODAY, "setup", "Profile set up")] });
}
/** Demo: example data, but only 2 weigh-ins in the last 7 days → no trend shown. */
export function sparseWeighIns() {
  const s = seed();
  for (let i = 0; i < 7; i++) { const d = addDays(DEMO_TODAY, -i); if (i !== 0 && i !== 3) delete s.weights[d]; }
  replaceWith(s);
}
/** Demo: first sign-in, no profile yet → onboarding. */
export function startOnboarding() {
  const s = seed();
  replaceWith({ ...s, onboarded: false, weights: {}, entries: [], groups: [], lastUsed: {}, complete: {}, history: [], myFoods: [], servings: {} });
}
export function finishOnboarding(p: Profile, weightKg: number) {
  Object.assign(state.profile, p, { startWeight: weightKg });
  state.weights = { [today]: Math.round(weightKg * 10) / 10 };
  state.entries = []; state.groups = []; state.lastUsed = {}; state.complete = {}; state.myFoods = []; state.servings = {};
  state.history = [makeRow(state.profile, state.weights, today, "setup", `Profile set up · ${p.goal === "maintain" ? "maintain" : `${p.goal} ${p.rate} kg/week`}`)];
  syncProfileSnapshot();
  state.onboarded = true;
}

// ---------- target history (S1) ----------
/** Profile and macro changes write a row dated today; past rows are never edited. */
let snap = JSON.stringify(state.profile);
function syncProfileSnapshot() { snap = JSON.stringify(state.profile); }
const MODE_LABEL = (m: unknown) => (m === "manual" ? "My own number" : "By rate");
const FIELD_NOTE: Record<string, [TargetReason, (a: unknown, b: unknown) => string]> = {
  goalMode: ["mode_switch", (a, b) => `${MODE_LABEL(a)} → ${MODE_LABEL(b)}${b === "manual" ? ` (${Number(state.profile.manualKcal).toLocaleString("en-US")} kcal)` : ""}`],
  manualKcal: ["manual_changed", (a, b) => `Own number ${Number(a).toLocaleString("en-US")} → ${Number(b).toLocaleString("en-US")} kcal`],
  rate: ["goal", (a, b) => `Rate ${a} → ${b} kg/week`],
  goal: ["goal", (a, b) => `Goal ${a} → ${b}`],
  goalWeight: ["goal", (a, b) => `Goal weight ${a} → ${b} kg`],
  proteinPerKg: ["macro", (a, b) => `Protein ${Number(a).toFixed(1)} → ${Number(b).toFixed(1)} g/kg`],
  fatPct: ["macro", (a, b) => `Fat ${a} → ${b} %`],
  activity: ["profile", (a, b) => `Activity ${a} → ${b}`],
  sex: ["profile", (a, b) => `Sex ${a} → ${b}`],
  birthYear: ["profile", (a, b) => `Birth year ${a} → ${b}`],
  heightCm: ["profile", (a, b) => `Height ${a} → ${b} cm`],
};
watch(() => JSON.stringify(state.profile), (now) => {
  if (!state.onboarded) { snap = now; return; }
  const before = JSON.parse(snap) as Record<string, unknown>, after = JSON.parse(now) as Record<string, unknown>;
  snap = now;
  const manual = after.goalMode === "manual";
  const changed = Object.keys(FIELD_NOTE).filter((k) => before[k] !== after[k])
    // S7: in manual mode rate/goal don't change the target; in rate mode the remembered number doesn't either
    .filter((k) => !(manual && (k === "rate" || k === "goal")) && !(!manual && k === "manualKcal") && !(k === "manualKcal" && before.goalMode !== after.goalMode));
  if (!changed.length) return;
  const last = state.history[state.history.length - 1];
  const sameDay = !!last && last.date === today;
  // approved 24 Oct 2026: every change on one day lands in ONE row (latest values, all reasons listed).
  // Changes to the same field keep the value from before the first change; a change undone the same day drops out.
  const base: TargetRow["changes"] = sameDay ? [...(last.changes ?? (last.field ? [{ field: last.field, reason: last.reason, from: undefined, to: undefined }] : []))] : [];
  for (const k of changed) {
    const i = base.findIndex((c) => c.field === k);
    if (i >= 0) base[i] = { ...base[i], to: after[k], from: base[i].from === undefined ? before[k] : base[i].from };
    else base.push({ field: k, reason: FIELD_NOTE[k][0], from: before[k], to: after[k] });
  }
  const changes = base.filter((c) => c.from === undefined || c.from !== c.to);
  const keptReasons = sameDay && !last.changes && !last.field ? [last.reason] : []; // e.g. a Monday update or setup earlier today
  const legacyNote = sameDay && !last.changes && last.field ? last.note : null; // seed row: keep its own note
  if (!changes.length && !keptReasons.length) { if (sameDay) state.history.splice(state.history.length - 1, 1); return; }
  const notes = changes.map((c) => (c.from === undefined && legacyNote ? legacyNote : FIELD_NOTE[c.field][1](c.from, c.to)));
  const reasons = [...new Set([...keptReasons, ...changes.map((c) => c.reason)])];
  const row = makeRow(state.profile, state.weights, today, reasons[reasons.length - 1], [...(keptReasons.length && sameDay ? [last.note] : []), ...notes].join("; "), changes[changes.length - 1]?.field);
  row.reasons = reasons; row.changes = changes;
  if (sameDay) state.history.splice(state.history.length - 1, 1, row); else state.history.push(row);
});
/** The row in effect on a date (null before the first target). */
export const targetRowFor = (date: string) => rowFor(state.history, date);
/** S7: did a manual (own-number) target apply on this date? */
export const isManual = (date: string) => rowFor(state.history, date)?.mode === "manual";
export const currentTarget = computed(() => rowFor(state.history, today));
export const firstTargetDate = computed(() => state.history[0]?.date ?? null);

// ---------- weight ----------
/** Smoothed trend on a date (null before the first weigh-in). */
export const trend = (date: string) => trendOf(state.weights, date);
/** Weigh-ins in the 7 days ending on `date`. */
export const weighInsLast7 = (date = today) => Object.keys(state.weights).filter((d) => d <= date && diffDays(date, d) < 7).length;
/** The trend is only shown with ≥3 weigh-ins in the last 7 days. */
export const trendShown = (date = today) => weighInsLast7(date) >= 3;
export const hasWeights = computed(() => Object.keys(state.weights).length > 0);
export const weighInCount = computed(() => Object.keys(state.weights).length);

/** Most recent weigh-in on or before `date`. */
export function latestWeighIn(date = today): { date: string; kg: number } | null {
  const ds = Object.keys(state.weights).filter((d) => d <= date).sort();
  const d = ds[ds.length - 1];
  return d ? { date: d, kg: state.weights[d] } : null;
}

/** Weight the targets use: the smoothed trend, or the setup weight before any weigh-in. */
export const trendWeight = computed(() => trend(today) ?? state.profile.startWeight);
export const trendVisible = computed(() => trendShown(today));

export function saveWeight(date: string, kg: number) {
  state.weights[date] = Math.round(kg * 10) / 10;
}
export function deleteWeight(date: string) {
  delete state.weights[date];
}

// ---------- targets ----------
/** Live calculation from the current profile and trend (what the next update would give). */
export const targets = computed<Targets>(() => calcTargets(state.profile, trendWeight.value, parse(today).getFullYear()));
/** Each day's own target from target history (S1); null = before the first target ("no target"). */
export function targetFor(date: string): { kcal: number; p: number; f: number; c: number } | null {
  const r = rowFor(state.history, date);
  return r ? { kcal: r.kcal, p: r.p, f: r.f, c: r.c } : null;
}
/** Today's target as shown in the UI (falls back to the live calculation before any history exists). */
export const shown = computed(() => {
  const r = currentTarget.value;
  if (r) return { kcal: r.kcal, p: r.p, f: r.f, c: r.c };
  const t = targets.value;
  return { kcal: Math.round(t.kcal), p: Math.round(t.protein), f: Math.round(t.fat), c: Math.round(t.carbs) };
});

// ---------- food log ----------
let seq = Date.now();
const newId = () => `n${(seq++).toString(36)}`;
const byTime = (a: Entry, b: Entry) => a.time.localeCompare(b.time);

/** One day's entries in time order. */
export const entriesFor = (date: string) => state.entries.filter((e) => e.date === date).sort(byTime);

/** Consecutive entries closer than CLUSTER_GAP_MIN form one visual cluster (no meal names). */
export function clustersFor(date: string): { start: string; end: string; items: Entry[]; kcal: number }[] {
  const out: { start: string; end: string; items: Entry[]; kcal: number }[] = [];
  for (const e of entriesFor(date)) {
    const last = out[out.length - 1];
    if (last && toMin(e.time) - toMin(last.end) <= CLUSTER_GAP_MIN) { last.items.push(e); last.end = e.time; last.kcal += e.kcal; }
    else out.push({ start: e.time, end: e.time, items: [e], kcal: e.kcal });
  }
  return out;
}

export function totals(list: { kcal: number; p: number; f: number; c: number }[]): Totals {
  return list.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, f: t.f + e.f, c: t.c + e.c }), { kcal: 0, p: 0, f: 0, c: 0 });
}
export const dayTotals = (date: string) => totals(entriesFor(date));
export const hasLog = (date: string) => state.entries.some((e) => e.date === date);

export function addEntry(e: Omit<Entry, "id">): Entry {
  const entry = { ...e, id: newId() };
  state.entries.push(entry);
  if (e.foodId && e.grams) state.lastUsed[e.foodId] = { at: Date.now(), grams: e.grams, amount: e.amount, unit: e.unit };
  return entry;
}
/** "2 pieces" / "180 g" — what the entry was logged as (S2); for per-serving foods never a fake gram figure */
export function amountOf(e: { amount?: number; unit?: string; grams?: number }): string {
  if (e.unit && e.amount != null) return amountLabel(e.amount, e.unit);
  return e.grams ? `${e.grams} g` : "";
}
export function updateEntry(id: string, patch: Partial<Entry>) {
  const e = state.entries.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
}
export function removeEntries(ids: string[]): Entry[] {
  const removed = state.entries.filter((e) => ids.includes(e.id));
  state.entries = state.entries.filter((e) => !ids.includes(e.id));
  return removed;
}
export function restoreEntries(list: Entry[]) { state.entries.push(...list); }
/** Copy entries to a day, keeping their times. Returns the new ids. */
export function copyEntries(list: Entry[], toDate: string): string[] {
  return list.map(({ id: _id, ...rest }) => addEntry({ ...rest, date: toDate }).id);
}

// ---------- saved groups ----------
export function saveGroup(name: string, list: GroupItem[]): SavedGroup {
  const g: SavedGroup = { id: newId(), name: name.trim() || "My group", items: list.map(({ foodId, name, grams, amount, unit, per100, kcal, p, f, c }) => ({ foodId, name, grams, amount, unit, per100, kcal, p, f, c })) };
  state.groups.unshift(g);
  return g;
}
export function deleteGroup(id: string) { state.groups = state.groups.filter((g) => g.id !== id); }
export function logGroup(g: SavedGroup, date: string, time: string): string[] {
  return g.items.map((it) => addEntry({ ...it, date, time }).id);
}
export const groupKcal = (g: SavedGroup) => g.items.reduce((s, i) => s + i.kcal, 0);

/** Calendar shade: closeness of the day's calories to that day's own target. */
export type Shade = "on" | "close" | "off" | "far" | "none" | "notarget";
export function shadeFor(date: string): Shade {
  if (!hasLog(date)) return "none";
  const tg = targetFor(date);
  if (!tg) return "notarget";
  const dev = Math.abs(dayTotals(date).kcal / tg.kcal - 1) * 100;
  return dev <= 5 ? "on" : dev <= 10 ? "close" : dev <= 20 ? "off" : "far";
}
/** Over the calorie target by more than the ±5 % band (shown in a distinct neutral style, never red). */
export const isOver = (date: string) => { const tg = targetFor(date); return !!tg && hasLog(date) && dayTotals(date).kcal > tg.kcal * 1.05; };

/** Decision 7: kcal ±5 %, protein ≥ target, fat and carbs ±10 %. */
export type MacroStatus = "under" | "hit" | "over";
export function macroStatus(kind: "kcal" | "p" | "f" | "c", cur: number, tgt: number): MacroStatus {
  if (kind === "p") return cur >= tgt ? "hit" : "under";
  const band = kind === "kcal" ? 0.05 : 0.1;
  if (cur > tgt * (1 + band)) return "over";
  if (cur >= tgt * (1 - band)) return "hit";
  return "under";
}
export function setComplete(date: string, v: boolean) {
  if (v) state.complete[date] = true; else delete state.complete[date];
}

export function avgIntake(dates: string[]): { avg: number; days: number } {
  const logged = dates.filter(hasLog);
  const sum = logged.reduce((s, d) => s + dayTotals(d).kcal, 0);
  return { avg: logged.length ? sum / logged.length : 0, days: logged.length };
}

export { range };

// ---------- foods: custom foods (S3) and servings (S2) ----------
export const findFood = (id: string): Food | undefined => FOODS.find((f) => f.id === id) ?? state.myFoods.find((f) => f.id === id);
/** Searchable foods: built-in + my foods (deleted ones hidden; their past entries stay). */
export const allFoods = () => [...state.myFoods.filter((f) => !f.deleted), ...FOODS];
export interface UnitOpt { unit: string; g: number; mine?: boolean }
/** g always (unless entered per serving only), ml for liquids, then the source's servings and my own. */
export function unitsFor(f: Food): UnitOpt[] {
  const out: UnitOpt[] = [];
  if (!f.servingOnly) out.push({ unit: "g", g: 1 });
  if (f.liquid) out.push({ unit: "ml", g: 1 });
  for (const s2 of f.servings ?? []) out.push({ unit: s2.name, g: s2.g, mine: s2.mine });
  for (const s2 of state.servings[f.id] ?? []) out.push({ unit: s2.name, g: s2.g, mine: true });
  return out;
}
export function addServing(foodId: string, name: string, g: number) {
  const list = state.servings[foodId] ?? (state.servings[foodId] = []);
  const i = list.findIndex((x) => x.name === name);
  if (i >= 0) list.splice(i, 1, { name, g, mine: true }); else list.push({ name, g, mine: true });
}
export function removeServing(foodId: string, name: string) {
  state.servings[foodId] = (state.servings[foodId] ?? []).filter((x) => x.name !== name);
}
export function createFood(f: Omit<Food, "id" | "mine">): Food {
  const food: Food = { ...f, id: `my${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, mine: true };
  state.myFoods.unshift(food);
  return food;
}
/** Editing a food never touches past entries: they keep their own per-100 g snapshot. */
export function updateFood(id: string, patch: Partial<Food>) {
  const f = state.myFoods.find((x) => x.id === id);
  if (f) Object.assign(f, patch);
}
export function deleteFood(id: string) { updateFood(id, { deleted: true }); delete state.lastUsed[id]; }

// ---------- S7: manual calorie goal ----------
/** Demo: "My own number" 2,000 kcal since Thu 22 Oct (This week mixes rate and manual days).
 *  reached = goal weight 84 kg, so the trend (83.6) has reached it → goal-reached question. */
export function manualDemo(reached = false) {
  const s = seed();
  const P: Profile = { ...SEED_PROFILE, goalMode: "manual", manualKcal: 2000, manualDir: "lose", goalWeight: reached ? 84 : 80 };
  const before = { ...P, goalWeight: 82 };
  s.profile = P;
  s.history = [
    ...s.history.filter((r) => r.date < "2026-10-22"),
    makeRow(before, s.weights, "2026-10-22", "mode_switch", "By rate → My own number (2,000 kcal)", "goalMode"),
    makeRow(P, s.weights, DEMO_TODAY, "goal", `Goal weight 82 → ${P.goalWeight} kg`, "goalWeight"),
  ];
  replaceWith(s);
}
const goalKey = () => `${state.profile.goalMode ?? "rate"}|${state.profile.goalWeight}|${state.profile.manualKcal ?? ""}`;
/** Decision 12 / S7: trend reached the goal weight from the direction that was set → ask, change nothing. */
export const goalReached = computed(() => {
  const p = state.profile;
  if (!state.onboarded || !trendShown(today) || state.goalAnswered === goalKey()) return false;
  const dir = p.goalMode === "manual" ? p.manualDir : p.goal === "maintain" ? undefined : p.goal;
  const t = trendWeight.value;
  return dir === "lose" ? t <= p.goalWeight : dir === "gain" ? t >= p.goalWeight : false;
});
export function keepGoal() { state.goalAnswered = goalKey(); }
export function switchToMaintain() {
  if (state.profile.goalMode === "manual") Object.assign(state.profile, { goalMode: "rate", goal: "maintain" });
  else state.profile.goal = "maintain";
}
/** S7: switch modes; manual pre-fills the last number (or today's target rounded to 10) and records the direction */
export function setGoalMode(m: "rate" | "manual") {
  const p = state.profile;
  if ((p.goalMode ?? "rate") === m) return;
  if (m === "manual") {
    const n = p.manualKcal ?? Math.round((currentTarget.value?.kcal ?? targets.value.kcal) / 10) * 10;
    Object.assign(p, { manualKcal: n, manualDir: trendWeight.value > p.goalWeight ? "lose" : "gain", goalMode: "manual" });
  } else p.goalMode = "rate";
}
