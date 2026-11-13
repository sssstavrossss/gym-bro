import { reactive } from "vue";
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
  type LogEntryResponse,
  type TargetsResponse,
} from "../api";
import { byTime } from "../lib/dayLog";
import { addDays, todayInZone, todayIso, weekStart } from "../lib/dates";
import { boot } from "./boot";
import { deviceTimeZone } from "./profile";
import { toast } from "../ui";

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
  source: string;
  foodId: string | null;
  groupId: string | null;
  idempotencyKey: string;
}

export interface PendingAdd {
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
  pending: [] as PendingAdd[],
  loading: false,
  loaded: false,
  unreachable: false,
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
});

export interface DayTotals {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

function pendingStorageKey(): string {
  return `gymbro-pending:${boot.accountId}`;
}

function rememberPending(): void {
  log.unreachable = log.pending.length > 0;
  if (!boot.accountId) return;
  sessionStorage.setItem(pendingStorageKey(), JSON.stringify(log.pending));
}

function readPending(): void {
  log.pending = [];
  if (!boot.accountId) {
    log.unreachable = false;
    return;
  }
  try {
    const raw = sessionStorage.getItem(pendingStorageKey());
    const parsed = raw ? JSON.parse(raw) as PendingAdd[] : [];
    log.pending = Array.isArray(parsed) ? parsed : [];
  } catch {
    log.pending = [];
  }
  log.unreachable = log.pending.length > 0;
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
  sortInto(log.entries, entry, log.date === entry.localDate);
  sortInto(viewed.entries, entry, viewed.date === entry.localDate);
  noteLogged(entry.localDate);
  rememberViewed();
}

export function findEntry(id: string | null): LogEntry | null {
  if (!id) return null;
  return viewed.entries.find((row) => row.id === id) ?? log.entries.find((row) => row.id === id) ?? null;
}

export function totalsOf(entries: readonly Pick<LogEntry, "kcal" | "protein" | "fat" | "carbs">[]): DayTotals {
  return entries.reduce((sum, row) => ({
    kcal: sum.kcal + row.kcal,
    p: sum.p + row.protein,
    f: sum.f + row.fat,
    c: sum.c + row.carbs,
  }), { kcal: 0, p: 0, f: 0, c: 0 });
}

export function pendingFor(date: string): PendingAdd[] {
  return log.pending.filter((row) => row.localDate === date);
}

function dropPending(key: string): void {
  log.pending = log.pending.filter((row) => row.idempotencyKey !== key);
  rememberPending();
}

export function dayTotals(): DayTotals {
  return totalsOf(log.entries);
}

export function hasLog(): boolean {
  return log.entries.length > 0 || log.pending.length > 0;
}

let generation = 0;

export async function loadToday(): Promise<void> {
  const gen = ++generation;
  readPending();
  const date = todayIso();
  log.loading = true;
  try {
    const body = await listLogEntries(date);
    if (gen !== generation) return;
    log.date = body.localDate;
    log.entries = body.entries.map(fromResponse);
    log.loaded = true;
  } catch (error) {
    if (gen !== generation) return;
    log.loaded = true;
    if (error instanceof ServerUnreachable) log.unreachable = true;
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
  viewed.entries = snap.entries;
  viewed.target = snap.target;
  viewed.firstTargetDate = snap.firstTargetDate;
  viewed.complete = snap.complete;
  viewed.fasting = snap.fasting;
  viewed.loaded = true;
  viewed.pendingDate = "";
  viewed.dim = false;
  if (snap.date === viewed.today) {
    log.date = snap.date;
    log.entries = snap.entries.map((row) => ({ ...row }));
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

async function fetchDay(date: string, zone: string): Promise<CachedDay> {
  const [list, targets, status] = await Promise.all([
    listLogEntries(date),
    getTargets(date),
    getDayStatus(date, zone),
  ]);
  return {
    date: list.localDate,
    entries: list.entries.map(fromResponse),
    target: targets.targets,
    firstTargetDate: targets.firstTargetDate,
    complete: status.complete,
    fasting: status.fasting,
  };
}

function prefetchDay(date: string, zone: string, today: string): void {
  if (!date || date > today || dayCache.has(date) || prefetching.has(date)) return;
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
  const asked = date > clientToday ? clientToday : date;
  const cached = dayCache.get(asked);
  if (cached) showCached(cached);
  else if (viewed.loaded) holdPrevious(asked);
  else viewed.loading = true;
  try {
    const days = await listLogDays(weekStart(asked), addDays(weekStart(asked), 6), zone);
    if (gen !== viewGeneration) return;
    const today = days.today || clientToday;
    const day = asked > today ? today : days.setupDate && asked < days.setupDate ? days.setupDate : asked;
    const snap = await fetchDay(day, zone);
    if (gen !== viewGeneration) return;
    viewed.setupDate = days.setupDate;
    viewed.today = today;
    viewed.loggedDates = days.loggedDates;
    dayCache.set(snap.date, snap);
    showCached(snap);
    prefetchDay(addDays(snap.date, -1), zone, today);
    prefetchDay(addDays(snap.date, 1), zone, today);
  } catch (error) {
    if (gen !== viewGeneration) return;
    viewed.loaded = true;
    if (error instanceof ServerUnreachable) log.unreachable = true;
    else if (error instanceof ApiError) toast(error.message);
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
    if (error instanceof ServerUnreachable) log.unreachable = true;
    toast(error instanceof ApiError ? error.message : "Couldn't update that day.");
    return false;
  }
}

export type SaveResult =
  | { ok: true; entry: LogEntry }
  | { ok: false; unreachable: true; message?: undefined }
  | { ok: false; unreachable?: false; message: string };

function keepPending(pending: PendingAdd): void {
  const index = log.pending.findIndex((row) => row.idempotencyKey === pending.idempotencyKey);
  if (index >= 0) log.pending.splice(index, 1, pending);
  else log.pending.push(pending);
  rememberPending();
}

export async function saveQuickAdd(pending: PendingAdd): Promise<SaveResult> {
  try {
    const saved = await addLogEntry({
      idempotencyKey: pending.idempotencyKey,
      localDate: pending.localDate,
      timeZone: pending.timeZone,
      name: pending.name,
      time: pending.time,
      kcal: pending.kcal,
      protein: pending.protein,
      fat: pending.fat,
      carbs: pending.carbs,
      ...(pending.foodId ? { foodId: pending.foodId, amount: pending.amount, unit: pending.unit } : {}),
    });
    if (saved.deletedAt) {
      keepPending(pending);
      return { ok: false, unreachable: true };
    }
    dropPending(pending.idempotencyKey);
    const entry = fromResponse(saved);
    place(entry);
    return { ok: true, entry };
  } catch (error) {
    if (error instanceof ServerUnreachable || (error instanceof ApiError && error.status >= 500)) {
      keepPending(pending);
      return { ok: false, unreachable: true };
    }
    const message = error instanceof ApiError ? error.message : "Couldn't save that entry.";
    return { ok: false, message };
  }
}

export async function retryPending(key: string): Promise<SaveResult> {
  const pending = log.pending.find((row) => row.idempotencyKey === key);
  if (!pending) return { ok: false, message: "That entry is no longer waiting." };
  return saveQuickAdd(pending);
}

export async function updateFoodAmount(id: string, values: { amount: number; unit: string; time: string | null }): Promise<SaveResult> {
  const body = {
    amount: values.amount,
    unit: values.unit,
    ...(values.time ? { time: values.time } : {}),
  };
  try {
    const saved = await patchLogEntry(id, body);
    const entry = fromResponse(saved);
    place(entry);
    return { ok: true, entry };
  } catch (error) {
    if (error instanceof ServerUnreachable || (error instanceof ApiError && error.status >= 500)) {
      log.unreachable = true;
      return { ok: false, unreachable: true };
    }
    const message = error instanceof ApiError ? error.message : "Couldn't save that entry.";
    return { ok: false, message };
  }
}

export async function updateQuickAdd(id: string, values: QuickValues): Promise<SaveResult> {
  const body = {
    name: values.name,
    kcal: values.kcal,
    protein: values.protein,
    fat: values.fat,
    carbs: values.carbs,
    ...(values.time ? { time: values.time } : {}),
  };
  try {
    const saved = await patchLogEntry(id, body);
    const entry = fromResponse(saved);
    place(entry);
    return { ok: true, entry };
  } catch (error) {
    if (error instanceof ServerUnreachable || (error instanceof ApiError && error.status >= 500)) {
      log.unreachable = true;
      return { ok: false, unreachable: true };
    }
    const message = error instanceof ApiError ? error.message : "Couldn't save that entry.";
    return { ok: false, message };
  }
}

export async function removeEntry(entry: LogEntry): Promise<boolean> {
  return removeEntries([entry]);
}

/** Soft-deletes every row. Undo restores the same ids. A failure restores any that already went. */
export async function removeEntries(entries: LogEntry[], options?: { announce?: boolean }): Promise<boolean> {
  if (!entries.length) return false;
  const announce = options?.announce !== false;
  const removed: LogEntry[] = [];
  try {
    for (const entry of entries) {
      await deleteLogEntry(entry.id);
      removed.push(entry);
    }
  } catch (error) {
    for (const entry of removed) {
      try {
        place(fromResponse(await restoreLogEntry(entry.id)));
      } catch {
        // The next undo toast can still restore whatever the server kept.
      }
    }
    if (error instanceof ServerUnreachable) log.unreachable = true;
    const fallback = entries.length > 1
      ? "Couldn't delete those entries. They're still here."
      : "Couldn't delete that entry. It's still here.";
    toast(error instanceof ApiError ? error.message : fallback);
    return false;
  }
  for (const entry of removed) {
    log.entries = log.entries.filter((row) => row.id !== entry.id);
    viewed.entries = viewed.entries.filter((row) => row.id !== entry.id);
    noteIfEmpty(entry.localDate);
  }
  rememberViewed();
  if (announce) {
    toast(removed.length === 1 ? `Deleted ${removed[0].name}` : `Deleted ${removed.length} items`, {
      label: "Undo",
      run: () => { void undoDeletes(removed); },
    });
  }
  return true;
}

async function undoDeletes(entries: LogEntry[]): Promise<void> {
  const pending: LogEntry[] = [];
  for (const entry of entries) {
    try {
      place(fromResponse(await restoreLogEntry(entry.id)));
    } catch {
      pending.push(entry);
    }
  }
  if (!pending.length) return;
  toast(pending.length === 1 ? `Deleted ${pending[0].name}` : `Deleted ${pending.length} items`, {
    label: "Undo",
    run: () => { void undoDeletes(pending); },
  });
}

export async function copySelected(
  entries: LogEntry[],
  localDate: string,
  keys: Record<string, string>,
): Promise<{ ok: true; copies: LogEntry[] } | { ok: false; message: string }> {
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
    if (error instanceof ServerUnreachable) {
      log.unreachable = true;
      return { ok: false, message: "Server unreachable, try again." };
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "Couldn't copy those entries." };
  }
}

/** Undo a copy by soft-deleting the new rows. The originals stay. */
export async function discardCopies(entries: LogEntry[]): Promise<void> {
  await removeEntries(entries, { announce: false });
}
