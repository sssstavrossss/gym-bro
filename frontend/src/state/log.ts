import { reactive } from "vue";
import {
  addLogEntry,
  ApiError,
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
    idempotencyKey: row.idempotencyKey,
  };
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

let viewGeneration = 0;

export async function loadDay(date: string): Promise<void> {
  const gen = ++viewGeneration;
  const zone = deviceTimeZone();
  const clientToday = todayInZone(zone);
  const asked = date > clientToday ? clientToday : date;
  viewed.loading = true;
  try {
    const days = await listLogDays(weekStart(asked), addDays(weekStart(asked), 6), zone);
    if (gen !== viewGeneration) return;
    const today = days.today || clientToday;
    const day = asked > today ? today : days.setupDate && asked < days.setupDate ? days.setupDate : asked;
    const [list, targets, status] = await Promise.all([
      listLogEntries(day),
      getTargets(day),
      getDayStatus(day, zone),
    ]);
    if (gen !== viewGeneration) return;
    const entries = list.entries.map(fromResponse);
    viewed.date = list.localDate;
    viewed.entries = entries;
    viewed.target = targets.targets;
    viewed.firstTargetDate = targets.firstTargetDate;
    viewed.complete = status.complete;
    viewed.fasting = status.fasting;
    viewed.setupDate = days.setupDate;
    viewed.today = today;
    viewed.loggedDates = days.loggedDates;
    viewed.loaded = true;
    if (list.localDate === today) {
      log.date = list.localDate;
      log.entries = entries.map((row) => ({ ...row }));
      log.loaded = true;
    }
  } catch (error) {
    if (gen !== viewGeneration) return;
    viewed.loaded = true;
    if (error instanceof ServerUnreachable) log.unreachable = true;
    else if (error instanceof ApiError) toast(error.message);
  } finally {
    if (gen === viewGeneration) viewed.loading = false;
  }
}

export async function setDayComplete(date: string, complete: boolean, fasting: boolean): Promise<boolean> {
  try {
    const saved = await putDayStatus(date, { complete, fasting, timeZone: deviceTimeZone() });
    if (viewed.date === saved.localDate) {
      viewed.complete = saved.complete;
      viewed.fasting = saved.fasting;
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
  try {
    await deleteLogEntry(entry.id);
  } catch (error) {
    if (error instanceof ServerUnreachable) log.unreachable = true;
    toast(error instanceof ApiError ? error.message : "Couldn't delete that entry. It's still here.");
    return false;
  }
  const date = entry.localDate;
  log.entries = log.entries.filter((row) => row.id !== entry.id);
  viewed.entries = viewed.entries.filter((row) => row.id !== entry.id);
  noteIfEmpty(date);
  toast(`Deleted ${entry.name}`, {
    label: "Undo",
    run: () => { void undoDelete(entry); },
  });
  return true;
}

async function undoDelete(entry: LogEntry): Promise<void> {
  try {
    const saved = await restoreLogEntry(entry.id);
    place(fromResponse(saved));
  } catch {
    toast(`Deleted ${entry.name}`, {
      label: "Undo",
      run: () => { void undoDelete(entry); },
    });
  }
}
