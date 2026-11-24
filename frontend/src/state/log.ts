import { getCurrentInstance, onBeforeUnmount, reactive, watch } from "vue";
import {
  addLogEntry,
  ApiError,
  copyLogEntries,
  deleteLogEntry,
  getDayStatus,
  getTargets,
  listLogDays,
  listLogEntries,
  patchLogEntry,
  putDayStatus,
  restoreLogEntry,
  ServerUnreachable,
  type LogCreateBody,
  type LogDaysResponse,
  type LogEntryResponse,
  type LogPatchBody,
  type TargetsResponse,
} from "../api";
import { byTime, lastPlanDate } from "../lib/dayLog";
import { addDays, timeInZone, todayInZone, todayIso, weekStart } from "../lib/dates";
import { sentToast } from "../lib/offline";
import {
  asQuickAdd,
  copyOp,
  isLocalId,
  localId,
  overlay,
  queueCreate,
  queueDelete,
  queuePatch,
  queueRestore,
  settle,
  type QueueMark,
  type QueuedRow,
} from "../lib/outbox";
import { connection } from "./connection";
import { hasSendable, outbox, sendQueued, setOps, type QueuedOp } from "./outbox";
import { deviceTimeZone } from "./profile";
import { toast, toastError, ui } from "../ui";

export interface LogEntry {
  id: string;
  localDate: string;
  time: string;
  timeZone: string;
  name: string;
  amount: number;
  unit: string;
  grams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  nutrients?: Record<string, number | null> | null;
  source: string;
  foodId: string | null;
  groupId: string | null;
  idempotencyKey: string;
  /** Not on the server yet ("waiting"), or refused by it ("failed", with the reason in queuedNote). */
  queued?: QueueMark;
  queuedNote?: string;
}

/** A new entry: a quick add, or a food with its amount (the numbers are the phone's estimate). */
export interface NewEntry {
  idempotencyKey: string;
  localDate: string;
  time: string | null;
  timeZone: string;
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  foodId?: string;
  amount?: number;
  unit?: string;
}

export interface QuickValues {
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  time: string | null;
}

export const log = reactive({
  date: "",
  entries: [] as LogEntry[],
  loading: false,
  loaded: false,
  /** Goes up whenever an entry is added, edited, moved, copied, deleted or restored, on any
   * day. Home's charts reload on it, since their numbers come from the server. */
  revision: 0,
});

/** The day open on Today or Log. Today's own list stays in `log` for the side column. */
export const viewed = reactive({
  date: "",
  entries: [] as LogEntry[],
  target: null as TargetsResponse | null,
  firstTargetDate: null as string | null,
  complete: false,
  fasting: false,
  setupDate: "",
  today: "",
  loggedDates: [] as string[],
  loading: false,
  loaded: false,
  /** Day the user asked for while an older day is still on screen. */
  pendingDate: "",
  /** True only after a day switch has already been waiting ~150ms. */
  dim: false,
  /** Offline, and this day was never loaded on this phone: only what was queued here shows. */
  missing: false,
});

export interface DayTotals {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

function fromResponse(row: LogEntryResponse): LogEntry {
  return {
    id: row.id,
    localDate: row.localDate,
    time: row.time,
    timeZone: row.timeZone,
    name: row.name,
    amount: row.amount,
    unit: row.unit,
    grams: row.grams,
    kcal: row.kcal,
    protein: row.protein,
    fat: row.fat,
    carbs: row.carbs,
    saturatedFat: row.saturatedFat,
    sugars: row.sugars,
    fiber: row.fiber,
    salt: row.salt,
    nutrients: row.nutrients,
    source: row.source,
    foodId: row.foodId,
    groupId: row.groupId,
    idempotencyKey: row.idempotencyKey,
  };
}

/** Puts log rows from a group re-add onto the open day. Does not touch day complete. */
export function rememberEntries(rows: LogEntryResponse[]): LogEntry[] {
  const entries = rows.filter((row) => !row.deletedAt).map(fromResponse);
  for (const entry of entries) place(entry);
  return entries;
}

function sortInto(list: LogEntry[], entry: LogEntry, acceptNew: boolean): void {
  const index = list.findIndex((row) => row.id === entry.id);
  if (index >= 0) {
    if (!acceptNew) list.splice(index, 1);
    else list.splice(index, 1, entry);
  } else if (acceptNew) {
    list.push(entry);
  }
  const ordered = byTime(list);
  list.splice(0, list.length, ...ordered);
}

function noteLogged(date: string): void {
  if (!viewed.loggedDates.includes(date)) viewed.loggedDates.push(date);
}

function noteIfEmpty(date: string): void {
  const count = viewed.date === date ? viewed.entries.length : log.date === date ? log.entries.length : null;
  if (count === 0) viewed.loggedDates = viewed.loggedDates.filter((day) => day !== date);
}

/** Puts the entry on today's list and on the open day. Does not touch day complete. */
function place(entry: LogEntry): void {
  log.revision += 1;
  sortInto(log.entries, entry, log.date === entry.localDate);
  sortInto(viewed.entries, entry, viewed.date === entry.localDate);
  noteLogged(entry.localDate);
  rememberViewed();
}

/**
 * Calls `reload` shortly after the log changes on any day, once for a burst of changes (a saved
 * group, an undo of several). For views whose numbers come from the server, such as Home's charts.
 */
export function onLogChange(reload: () => void, delay = 300): void {
  let timer = 0;
  watch(() => log.revision, () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(reload, delay);
  });
  if (getCurrentInstance()) onBeforeUnmount(() => window.clearTimeout(timer));
}

export function findEntry(id: string | null): LogEntry | null {
  if (!id) return null;
  return viewed.entries.find((row) => row.id === id) ?? log.entries.find((row) => row.id === id) ?? null;
}

/** A day's macros. An entry the server refused shows "couldn't send" and counts for nothing until it is saved again. */
export function totalsOf(entries: readonly (Pick<LogEntry, "kcal" | "protein" | "fat" | "carbs"> & Partial<Pick<LogEntry, "queued">>)[]): DayTotals {
  return entries.filter((row) => row.queued !== "failed").reduce((sum, row) => ({
    kcal: sum.kcal + row.kcal,
    p: sum.p + row.protein,
    f: sum.f + row.fat,
    c: sum.c + row.carbs,
  }), { kcal: 0, p: 0, f: 0, c: 0 });
}

/** A day's server rows with this phone's queued changes applied, in time order. */
function withQueue(entries: readonly LogEntry[], date: string): LogEntry[] {
  return byTime(overlay(entries, date, outbox.ops));
}

/** Adds the server already has (an answer lost on the way back) leave the queue. */
function settleQueue(rows: readonly QueuedRow[]): void {
  if (!outbox.ops.length) return;
  const next = settle(outbox.ops, rows);
  if (next.length !== outbox.ops.length) setOps(next);
}

/** Changes go to the queue while the server can't be reached, and behind anything already waiting, so order holds. */
function queueing(): boolean {
  return connection.offline || hasSendable();
}

/** The server can't take it now, but may later. */
function notNow(error: unknown): boolean {
  return error instanceof ServerUnreachable || (error instanceof ApiError && error.status >= 500);
}

/** After queueing while the server still answers (a 5xx, or an older change in front), try sending at once. */
function sendSoon(): void {
  if (!connection.offline) void sendQueue();
}

export function dayTotals(): DayTotals {
  return totalsOf(log.entries);
}

export function hasLog(): boolean {
  return log.entries.length > 0;
}

let generation = 0;

export async function loadToday(): Promise<void> {
  const gen = ++generation;
  const date = todayIso();
  log.loading = true;
  try {
    const body = await listLogEntries(date);
    if (gen !== generation) return;
    settleQueue(body.entries);
    log.date = body.localDate;
    log.entries = withQueue(body.entries.map(fromResponse), body.localDate);
    log.loaded = true;
  } catch {
    if (gen !== generation) return;
    // Today was never kept on this phone: show what was queued here.
    log.entries = withQueue(log.date === date ? log.entries : [], date);
    log.date = date;
    log.loaded = true;
  } finally {
    if (gen === generation) log.loading = false;
  }
}

interface CachedDay {
  date: string;
  entries: LogEntry[];
  target: TargetsResponse | null;
  firstTargetDate: string | null;
  complete: boolean;
  fasting: boolean;
}

const dayCache = new Map<string, CachedDay>();
const prefetching = new Map<string, Promise<void>>();
let dimTimer = 0;

function rememberViewed(): void {
  if (!viewed.loaded || !viewed.date) return;
  dayCache.set(viewed.date, {
    date: viewed.date,
    entries: viewed.entries,
    target: viewed.target,
    firstTargetDate: viewed.firstTargetDate,
    complete: viewed.complete,
    fasting: viewed.fasting,
  });
}

function showCached(snap: CachedDay): void {
  window.clearTimeout(dimTimer);
  viewed.date = snap.date;
  viewed.entries = withQueue(snap.entries, snap.date);
  viewed.missing = false;
  viewed.target = snap.target;
  viewed.firstTargetDate = snap.firstTargetDate;
  viewed.complete = snap.complete;
  viewed.fasting = snap.fasting;
  viewed.loaded = true;
  viewed.pendingDate = "";
  viewed.dim = false;
  if (snap.date === viewed.today) {
    log.date = snap.date;
    log.entries = viewed.entries.map((row) => ({ ...row }));
    log.loaded = true;
  }
}

function holdPrevious(date: string): void {
  window.clearTimeout(dimTimer);
  viewed.pendingDate = date;
  viewed.dim = false;
  dimTimer = window.setTimeout(() => {
    if (viewed.pendingDate === date && viewed.date !== date) viewed.dim = true;
  }, 150);
}

function clearHold(): void {
  window.clearTimeout(dimTimer);
  viewed.pendingDate = "";
  viewed.dim = false;
}

/** Offline, a part this phone never kept falls back to `fallback`. Any other failure still throws. */
async function orOffline<T>(job: Promise<T>, fallback: T): Promise<T> {
  try {
    return await job;
  } catch (error) {
    if (error instanceof ServerUnreachable) return fallback;
    throw error;
  }
}

async function fetchDay(date: string, zone: string): Promise<CachedDay> {
  const [list, targets, status] = await Promise.all([
    listLogEntries(date),
    orOffline(getTargets(date), { date, targets: viewed.date === date ? viewed.target : null, firstTargetDate: viewed.firstTargetDate }),
    orOffline(getDayStatus(date, zone), { localDate: date, complete: false, fasting: viewed.date === date && viewed.fasting }),
  ]);
  settleQueue(list.entries);
  return {
    date: list.localDate,
    entries: withQueue(list.entries.map(fromResponse), list.localDate),
    target: targets.targets,
    firstTargetDate: targets.firstTargetDate,
    complete: status.complete,
    fasting: status.fasting,
  };
}

/** Offline on a day this phone never loaded: the day shows with only its queued entries. */
function showMissing(date: string): void {
  if (viewed.date === date && viewed.loaded && !viewed.missing) return;
  viewed.date = date;
  viewed.entries = withQueue([], date);
  viewed.target = null;
  viewed.complete = false;
  viewed.fasting = false;
  viewed.missing = true;
  viewed.loaded = true;
}

function prefetchDay(date: string, zone: string, today: string, setupDate: string | null): void {
  // Before setup or past the plan window the server refuses the day (400), so there is nothing to fetch.
  if (!date || date > lastPlanDate(today) || (setupDate && date < setupDate) || dayCache.has(date) || prefetching.has(date)) return;
  const job = fetchDay(date, zone).then((snap) => {
    if (!dayCache.has(snap.date)) dayCache.set(snap.date, snap);
  }).catch(() => {
    // The next visit loads it itself.
  }).finally(() => {
    prefetching.delete(date);
  });
  prefetching.set(date, job);
}

let viewGeneration = 0;

export async function loadDay(date: string): Promise<void> {
  const gen = ++viewGeneration;
  const zone = deviceTimeZone();
  const clientToday = todayInZone(zone);
  const asked = date > lastPlanDate(clientToday) ? lastPlanDate(clientToday) : date;
  const cached = dayCache.get(asked);
  if (cached) showCached(cached);
  else if (viewed.loaded) holdPrevious(asked);
  else viewed.loading = true;
  try {
    const week: LogDaysResponse | null = await orOffline(listLogDays(weekStart(asked), addDays(weekStart(asked), 6), zone), null);
    if (gen !== viewGeneration) return;
    const setupDate = week?.setupDate ?? viewed.setupDate;
    const today = week?.today || clientToday;
    const day = asked > lastPlanDate(today) ? lastPlanDate(today) : setupDate && asked < setupDate ? setupDate : asked;
    const snap = await fetchDay(day, zone);
    if (gen !== viewGeneration) return;
    viewed.setupDate = setupDate;
    viewed.today = today;
    if (week) viewed.loggedDates = week.loggedDates;
    dayCache.set(snap.date, snap);
    showCached(snap);
    prefetchDay(addDays(snap.date, -1), zone, today, setupDate);
    prefetchDay(addDays(snap.date, 1), zone, today, setupDate);
  } catch (error) {
    if (gen !== viewGeneration) return;
    viewed.loaded = true;
    if (error instanceof ServerUnreachable) showMissing(asked);
    else if (error instanceof ApiError) toastError(error.message);
  } finally {
    if (gen === viewGeneration) {
      viewed.loading = false;
      clearHold();
    }
  }
}

export async function setFasting(date: string, fasting: boolean): Promise<boolean> {
  try {
    const saved = await putDayStatus(date, { fasting, timeZone: deviceTimeZone() });
    if (viewed.date === saved.localDate) {
      viewed.complete = saved.complete;
      viewed.fasting = saved.fasting;
      rememberViewed();
    }
    return true;
  } catch (error) {
    toastError(error instanceof ApiError ? error.message : connection.offline ? "Marking a fasting day needs a connection." : "Couldn't update that day.");
    return false;
  }
}

export type SaveResult =
  | { ok: true; entry: LogEntry; queued?: true }
  | { ok: false; message: string };

function localEntry(input: NewEntry, time: string): LogEntry {
  const food = Boolean(input.foodId);
  return {
    id: localId(input.idempotencyKey),
    localDate: input.localDate,
    time,
    timeZone: input.timeZone,
    name: input.name,
    amount: food ? input.amount ?? 1 : 1,
    unit: food ? input.unit ?? "" : "",
    grams: food && input.unit === "g" ? input.amount ?? null : null,
    kcal: input.kcal,
    protein: input.protein,
    fat: input.fat,
    carbs: input.carbs,
    source: food ? "food" : "quick",
    foodId: input.foodId ?? null,
    groupId: null,
    idempotencyKey: input.idempotencyKey,
    queued: "waiting",
  };
}

function queueAdd(input: NewEntry): SaveResult {
  // Sent later, so "now" is stamped here, not when the server finally gets it.
  const time = input.time ?? timeInZone(input.timeZone);
  const entry = localEntry(input, time);
  const body: LogCreateBody = {
    idempotencyKey: input.idempotencyKey,
    localDate: input.localDate,
    timeZone: input.timeZone,
    time,
    name: input.name,
    kcal: input.kcal,
    protein: input.protein,
    fat: input.fat,
    carbs: input.carbs,
    ...(input.foodId ? { foodId: input.foodId, amount: input.amount, unit: input.unit } : {}),
  };
  setOps(queueCreate(outbox.ops, { kind: "add", key: input.idempotencyKey, body, entry }));
  place(entry);
  sendSoon();
  return { ok: true, entry, queued: true };
}

/** Adds an entry. Without a server it is kept on the phone and sent later under the same key. */
export async function saveQuickAdd(input: NewEntry): Promise<SaveResult> {
  if (queueing()) return queueAdd(input);
  try {
    const saved = await addLogEntry({
      idempotencyKey: input.idempotencyKey,
      localDate: input.localDate,
      timeZone: input.timeZone,
      name: input.name,
      time: input.time,
      kcal: input.kcal,
      protein: input.protein,
      fat: input.fat,
      carbs: input.carbs,
      ...(input.foodId ? { foodId: input.foodId, amount: input.amount, unit: input.unit } : {}),
    });
    if (saved.deletedAt) {
      // This key was saved before and that entry has since been deleted. Sending again cannot bring it back.
      return { ok: false, message: "That entry was already deleted." };
    }
    const entry = fromResponse(saved);
    place(entry);
    return { ok: true, entry };
  } catch (error) {
    if (notNow(error)) return queueAdd(input);
    const message = error instanceof ApiError ? error.message : "Couldn't save that entry.";
    return { ok: false, message };
  }
}

function queueChange(id: string, body: LogPatchBody, entry: LogEntry | null): SaveResult {
  if (!entry) return { ok: false, message: "That entry isn't on this phone." };
  const shown: LogEntry = { ...entry, queued: entry.queued === "failed" ? "failed" : "waiting" };
  setOps(queuePatch(outbox.ops, id, body, shown));
  place(shown);
  sendSoon();
  return { ok: true, entry: shown, queued: true };
}

async function patchOrQueue(id: string, body: LogPatchBody, estimate: () => LogEntry | null): Promise<SaveResult> {
  if (isLocalId(id) || queueing()) return queueChange(id, body, estimate());
  try {
    const entry = fromResponse(await patchLogEntry(id, body));
    place(entry);
    return { ok: true, entry };
  } catch (error) {
    if (notNow(error)) return queueChange(id, body, estimate());
    const message = error instanceof ApiError ? error.message : "Couldn't save that entry.";
    return { ok: false, message };
  }
}

export interface AmountEstimate {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * The entry after an amount edit, as the phone can tell without the server: the sheet's preview
 * numbers when it has them, otherwise the old numbers scaled when the unit stayed the same.
 */
function amountEstimate(entry: LogEntry, values: { amount: number; unit: string; time: string | null }, estimate?: AmountEstimate): LogEntry {
  const ratio = entry.unit === values.unit && entry.amount > 0 ? values.amount / entry.amount : null;
  const scale = (value: number) => (ratio === null ? value : value * ratio);
  const scaleOrKeep = (value: number | null | undefined) => (value == null || ratio === null ? value : value * ratio);
  return {
    ...entry,
    amount: values.amount,
    unit: values.unit,
    time: values.time ?? entry.time,
    grams: values.unit === "g" ? values.amount : entry.grams == null || ratio === null ? null : entry.grams * ratio,
    kcal: estimate?.kcal ?? scale(entry.kcal),
    protein: estimate?.protein ?? scale(entry.protein),
    fat: estimate?.fat ?? scale(entry.fat),
    carbs: estimate?.carbs ?? scale(entry.carbs),
    saturatedFat: scaleOrKeep(entry.saturatedFat),
    sugars: scaleOrKeep(entry.sugars),
    fiber: scaleOrKeep(entry.fiber),
    salt: scaleOrKeep(entry.salt),
  };
}

export async function updateFoodAmount(
  id: string,
  values: { amount: number; unit: string; time: string | null },
  estimate?: AmountEstimate,
): Promise<SaveResult> {
  const body = {
    amount: values.amount,
    unit: values.unit,
    ...(values.time ? { time: values.time } : {}),
  };
  return patchOrQueue(id, body, () => {
    const entry = findEntry(id);
    return entry ? amountEstimate(entry, values, estimate) : null;
  });
}

export async function updateQuickAdd(id: string, values: QuickValues): Promise<SaveResult> {
  const entry = findEntry(id);
  if (entry?.queued === "failed") return resendAsQuickAdd(entry, values);
  const body = {
    name: values.name,
    kcal: values.kcal,
    protein: values.protein,
    fat: values.fat,
    carbs: values.carbs,
    ...(values.time ? { time: values.time } : {}),
  };
  return patchOrQueue(id, body, () => (entry ? { ...entry, ...body, time: values.time ?? entry.time } : null));
}

/** "Couldn't send": Save sends it again as a quick add with the numbers on screen. */
function resendAsQuickAdd(entry: LogEntry, values: QuickValues): SaveResult {
  const shown: LogEntry = {
    ...entry,
    name: values.name,
    kcal: values.kcal,
    protein: values.protein,
    fat: values.fat,
    carbs: values.carbs,
    time: values.time ?? entry.time,
    amount: 1,
    unit: "",
    grams: null,
    source: "quick",
    foodId: null,
    queued: "waiting",
    queuedNote: undefined,
  };
  setOps(asQuickAdd(outbox.ops, entry.idempotencyKey, values, shown));
  place(shown);
  sendSoon();
  return { ok: true, entry: shown, queued: true };
}

export async function removeEntry(entry: LogEntry): Promise<boolean> {
  return removeEntries([entry]);
}

interface Removal {
  entry: LogEntry;
  /** Deleted in the queue, not on the server. */
  queued: boolean;
  /** For an entry that never reached the server: its queued ops, which undo puts back. */
  undo: QueuedOp[];
}

function queueRemoval(entry: LogEntry): Removal {
  const { ops, undo } = queueDelete(outbox.ops, entry);
  setOps(ops);
  return { entry, queued: true, undo };
}

/** Brings one removed entry back. False only when the server refused. */
async function putBack(item: Removal): Promise<boolean> {
  const queueRestoreOf = () => {
    setOps(queueRestore(outbox.ops, item.entry, item.undo));
    place({ ...item.entry, queued: item.entry.queued ?? "waiting" });
    return true;
  };
  if (item.queued) {
    setOps(queueRestore(outbox.ops, item.entry, item.undo));
    place(item.entry);
    return true;
  }
  if (queueing()) return queueRestoreOf();
  try {
    place(fromResponse(await restoreLogEntry(item.entry.id)));
    return true;
  } catch (error) {
    if (notNow(error)) return queueRestoreOf();
    return false;
  }
}

/** Soft-deletes every row. Undo restores the same ids. A refusal puts back any that already went. */
export async function removeEntries(entries: LogEntry[], options?: { announce?: boolean }): Promise<boolean> {
  if (!entries.length) return false;
  const announce = options?.announce !== false;
  const removed: Removal[] = [];
  try {
    for (const entry of entries) {
      if (isLocalId(entry.id) || queueing()) {
        removed.push(queueRemoval(entry));
        continue;
      }
      try {
        await deleteLogEntry(entry.id);
        removed.push({ entry, queued: false, undo: [] });
      } catch (error) {
        if (!notNow(error)) throw error;
        removed.push(queueRemoval(entry));
      }
    }
  } catch (error) {
    for (const item of removed) await putBack(item);
    const fallback = entries.length > 1
      ? "Couldn't delete those entries. They're still here."
      : "Couldn't delete that entry. It's still here.";
    toastError(error instanceof ApiError ? error.message : fallback);
    return false;
  }
  if (removed.some((item) => item.queued)) sendSoon();
  log.revision += 1;
  for (const { entry } of removed) {
    log.entries = log.entries.filter((row) => row.id !== entry.id);
    viewed.entries = viewed.entries.filter((row) => row.id !== entry.id);
    noteIfEmpty(entry.localDate);
  }
  rememberViewed();
  if (announce) deletedToast(removed);
  return true;
}

async function undoDeletes(items: Removal[]): Promise<void> {
  const left: Removal[] = [];
  for (const item of items) {
    if (!(await putBack(item))) left.push(item);
  }
  sendSoon();
  if (!left.length) return;
  deletedToast(left);
}

/** "Deleted Egg" with Undo. Deletes back to back fold into one toast ("Deleted 3 items"). */
function deletedToast(items: Removal[]): void {
  toast(items.length === 1 ? `Deleted ${items[0].entry.name}` : `Deleted ${items.length} items`, {
    label: "Undo",
    run: () => { void undoDeletes(items); },
  }, { merge: { kind: "delete", count: items.length } });
}

function queueCopies(entries: LogEntry[], localDate: string, keys: Record<string, string>): { ok: true; copies: LogEntry[] } {
  const zone = deviceTimeZone();
  const copies: LogEntry[] = [];
  let ops = outbox.ops;
  for (const entry of entries) {
    const key = keys[entry.id] ?? crypto.randomUUID();
    const copy: LogEntry = { ...entry, id: localId(key), idempotencyKey: key, localDate, timeZone: zone, queued: "waiting", queuedNote: undefined };
    const op = copyOp(ops, entry.id, key, localDate, zone, copy);
    if (!op) continue;
    ops = queueCreate(ops, op);
    copies.push(copy);
  }
  setOps(ops);
  for (const copy of copies) place(copy);
  sendSoon();
  return { ok: true, copies };
}

export async function copySelected(
  entries: LogEntry[],
  localDate: string,
  keys: Record<string, string>,
): Promise<{ ok: true; copies: LogEntry[] } | { ok: false; message: string }> {
  // The server can't copy an entry it doesn't have yet.
  if (queueing() || entries.some((entry) => isLocalId(entry.id))) return queueCopies(entries, localDate, keys);
  try {
    const saved = await copyLogEntries({
      localDate,
      timeZone: deviceTimeZone(),
      items: entries.map((entry) => ({ id: entry.id, idempotencyKey: keys[entry.id] ?? crypto.randomUUID() })),
    });
    const copies = saved.entries.filter((row) => !row.deletedAt).map(fromResponse);
    for (const entry of copies) place(entry);
    return { ok: true, copies };
  } catch (error) {
    if (notNow(error)) return queueCopies(entries, localDate, keys);
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't copy those entries." };
  }
}

/** Undo a copy by soft-deleting the new rows. The originals stay. */
export async function discardCopies(entries: LogEntry[]): Promise<void> {
  await removeEntries(entries, { announce: false });
}

/** A queued add got its server id: an open sheet or a selection follows it. */
function followId(local: string, server: string): void {
  if (ui.editEntryId === local) ui.editEntryId = server;
  if (ui.selected.includes(local)) ui.selected = ui.selected.map((id) => (id === local ? server : id));
  if (ui.anchor === local) ui.anchor = server;
}

/** Refreshes today and the open day from the server, with what is still queued on top. */
async function reloadShown(): Promise<void> {
  await Promise.all([loadToday(), viewed.date ? loadDay(viewed.date) : Promise.resolve()]);
  log.revision += 1;
}

/** Sends what the phone queued, then shows the server's numbers. */
export async function sendQueue(): Promise<void> {
  const before = outbox.ops;
  const result = await sendQueued({ created: followId });
  // Nothing went and nothing came off the queue (an add whose entry was deleted elsewhere does).
  if (outbox.ops === before) return;
  await reloadShown();
  const text = sentToast(result);
  if (text) toast(text, undefined, { error: result.failed > 0 || result.dropped.length > 0 });
}

/** The server answers again: send the queue, or at least bring the screens up to date. */
export async function catchUp(): Promise<void> {
  if (hasSendable()) await sendQueue();
  else await reloadShown();
}
