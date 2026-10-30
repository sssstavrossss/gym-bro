import { reactive } from "vue";
import {
  addLogEntry,
  ApiError,
  deleteLogEntry,
  listLogEntries,
  patchLogEntry,
  restoreLogEntry,
  ServerUnreachable,
  type LogEntryResponse,
} from "../api";
import { todayIso } from "../lib/dates";
import { boot } from "./boot";
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
    idempotencyKey: row.idempotencyKey,
  };
}

function upsert(entry: LogEntry): void {
  const index = log.entries.findIndex((row) => row.id === entry.id);
  if (index >= 0) log.entries.splice(index, 1, entry);
  else log.entries.push(entry);
  log.entries.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

function dropPending(key: string): void {
  log.pending = log.pending.filter((row) => row.idempotencyKey !== key);
  rememberPending();
}

export function dayTotals(): DayTotals {
  return log.entries.reduce((sum, row) => ({
    kcal: sum.kcal + row.kcal,
    p: sum.p + row.protein,
    f: sum.f + row.fat,
    c: sum.c + row.carbs,
  }), { kcal: 0, p: 0, f: 0, c: 0 });
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
    });
    if (saved.deletedAt) {
      keepPending(pending);
      return { ok: false, unreachable: true };
    }
    dropPending(pending.idempotencyKey);
    const entry = fromResponse(saved);
    upsert(entry);
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
    upsert(entry);
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
  log.entries = log.entries.filter((row) => row.id !== entry.id);
  toast(`Deleted ${entry.name}`, {
    label: "Undo",
    run: () => { void undoDelete(entry); },
  });
  return true;
}

async function undoDelete(entry: LogEntry): Promise<void> {
  try {
    const saved = await restoreLogEntry(entry.id);
    upsert(fromResponse(saved));
  } catch {
    toast(`Deleted ${entry.name}`, {
      label: "Undo",
      run: () => { void undoDelete(entry); },
    });
  }
}
