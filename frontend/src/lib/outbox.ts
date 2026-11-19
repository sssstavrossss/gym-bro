import type { LogCreateBody, LogPatchBody } from "../api";

/**
 * Log changes made while the server can't be reached, kept in order until they can be sent.
 * Pure: every call returns a new list. state/outbox.ts persists it and sends it.
 *
 * A new entry has no server id yet, so it goes by `local:<idempotency key>`. Changes to it
 * fold into its add where they can; a delete drops it and everything queued for it.
 */

export type QueueMark = "waiting" | "failed";

export interface QueuedRow {
  id: string;
  idempotencyKey: string;
  localDate: string;
  time: string;
  /** Set on rows the overlay adds or changes: not on the server yet, or refused by it. */
  queued?: QueueMark;
  /** The server's reason, on a refused add. */
  queuedNote?: string;
}

export type CreateOp<E> =
  | { kind: "add"; key: string; body: LogCreateBody; entry: E; failed?: string }
  | { kind: "copy"; key: string; sourceId: string; localDate: string; timeZone: string; entry: E; failed?: string };

export type ChangeOp<E> =
  | { kind: "patch"; id: string; body: LogPatchBody; entry: E }
  | { kind: "delete"; id: string; entry: E }
  | { kind: "restore"; id: string; entry: E };

export type OutboxOp<E> = CreateOp<E> | ChangeOp<E>;

const LOCAL = "local:";

export function localId(key: string): string {
  return `${LOCAL}${key}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL);
}

export function isCreate<E>(op: OutboxOp<E>): op is CreateOp<E> {
  return op.kind === "add" || op.kind === "copy";
}

/** The entry id an op is about: the local id for a create. */
export function opEntryId<E>(op: OutboxOp<E>): string {
  return isCreate(op) ? localId(op.key) : op.id;
}


function lastFor<E>(ops: readonly OutboxOp<E>[], id: string): number {
  for (let index = ops.length - 1; index >= 0; index -= 1) if (opEntryId(ops[index]) === id) return index;
  return -1;
}

export function queueCreate<E>(ops: readonly OutboxOp<E>[], op: CreateOp<E>): OutboxOp<E>[] {
  const index = ops.findIndex((row) => isCreate(row) && row.key === op.key);
  if (index < 0) return [...ops, op];
  return ops.map((row, at) => (at === index ? op : row));
}

/**
 * A copy made offline. A server entry is copied by the server. A copy of an unsent add is an add of
 * its own, and a copy of an unsent copy copies the same server entry, so no op waits on another.
 */
export function copyOp<E extends QueuedRow>(
  ops: readonly OutboxOp<E>[],
  sourceId: string,
  key: string,
  localDate: string,
  timeZone: string,
  entry: E,
): CreateOp<E> | null {
  if (!isLocalId(sourceId)) return { kind: "copy", key, sourceId, localDate, timeZone, entry };
  const origin = ops.find((op): op is CreateOp<E> => isCreate(op) && localId(op.key) === sourceId);
  if (origin?.kind === "copy") return { kind: "copy", key, sourceId: origin.sourceId, localDate, timeZone, entry };
  if (origin?.kind === "add") return { kind: "add", key, body: { ...origin.body, idempotencyKey: key, localDate, timeZone }, entry };
  return null;
}

/** The fields of an add, as an edit of the entry it made. For an add that changed while it was being sent. */
export function createAsPatch(body: LogCreateBody): LogPatchBody {
  const where = { localDate: body.localDate, timeZone: body.timeZone, ...(body.time ? { time: body.time } : {}) };
  if (body.foodId) return { amount: body.amount, unit: body.unit, ...where };
  return { name: body.name, kcal: body.kcal, protein: body.protein, fat: body.fat, carbs: body.carbs, ...where };
}

/** An edit. On an unsent add it changes the add itself; on a server entry it follows any earlier edit. */
export function queuePatch<E extends QueuedRow>(ops: readonly OutboxOp<E>[], id: string, body: LogPatchBody, entry: E): OutboxOp<E>[] {
  const index = lastFor(ops, id);
  const last = index >= 0 ? ops[index] : null;
  if (last?.kind === "add") {
    return ops.map((row, at) => (at === index ? { ...last, body: { ...last.body, ...body }, entry } : row));
  }
  if (last?.kind === "patch") {
    return ops.map((row, at) => (at === index ? { ...last, body: { ...last.body, ...body }, entry } : row));
  }
  return [...ops, { kind: "patch", id, body, entry }];
}

/** A delete. An unsent entry just leaves the queue; `undo` is what queueRestore needs to bring it back. */
export function queueDelete<E extends QueuedRow>(ops: readonly OutboxOp<E>[], entry: E): { ops: OutboxOp<E>[]; undo: OutboxOp<E>[] } {
  if (isLocalId(entry.id)) {
    return {
      ops: ops.filter((op) => opEntryId(op) !== entry.id),
      undo: ops.filter((op) => opEntryId(op) === entry.id),
    };
  }
  return { ops: [...ops, { kind: "delete", id: entry.id, entry }], undo: [] };
}

/** Undo of a delete: an unsent delete is simply taken back. */
export function queueRestore<E extends QueuedRow>(ops: readonly OutboxOp<E>[], entry: E, undo: readonly OutboxOp<E>[]): OutboxOp<E>[] {
  if (undo.length) return [...ops, ...undo];
  const index = lastFor(ops, entry.id);
  if (index >= 0 && ops[index].kind === "delete") return ops.filter((_, at) => at !== index);
  return [...ops, { kind: "restore", id: entry.id, entry }];
}

/** The server gave a local entry its id: later ops follow it. */
export function rewriteId<E extends QueuedRow>(ops: readonly OutboxOp<E>[], from: string, to: string): OutboxOp<E>[] {
  return ops.map((op) => {
    if (!isCreate(op) && op.id === from) return { ...op, id: to, entry: { ...op.entry, id: to } };
    return op;
  });
}

/** Removes a create and everything queued for its entry. */
export function dropCreate<E>(ops: readonly OutboxOp<E>[], key: string): OutboxOp<E>[] {
  const id = localId(key);
  return ops.filter((op) => opEntryId(op) !== id);
}

/** Adds the server already has (an answer that got lost on the way back) leave the queue. */
export function settle<E extends QueuedRow>(ops: readonly OutboxOp<E>[], rows: readonly QueuedRow[]): OutboxOp<E>[] {
  let next = [...ops];
  for (const row of rows) {
    const index = next.findIndex((op) => isCreate(op) && op.key === row.idempotencyKey);
    if (index < 0) continue;
    const op = next[index] as CreateOp<E>;
    next = rewriteId(next.filter((_, at) => at !== index), localId(op.key), row.id);
  }
  return next;
}

export function markFailed<E>(ops: readonly OutboxOp<E>[], key: string, reason: string): OutboxOp<E>[] {
  return ops.map((op) => (isCreate(op) && op.key === key ? { ...op, failed: reason } : op));
}

/** A refused add tries again as a quick add with the numbers it shows. */
export function asQuickAdd<E extends QueuedRow>(
  ops: readonly OutboxOp<E>[],
  key: string,
  values: { name: string; kcal: number; protein: number; fat: number; carbs: number; time?: string | null },
  entry: E,
): OutboxOp<E>[] {
  return ops.map((op) => {
    if (!isCreate(op) || op.key !== key) return op;
    const body: LogCreateBody = {
      idempotencyKey: key,
      localDate: op.kind === "add" ? op.body.localDate : op.localDate,
      timeZone: op.kind === "add" ? op.body.timeZone : op.timeZone,
      time: values.time ?? (op.kind === "add" ? op.body.time : entry.time),
      name: values.name,
      kcal: values.kcal,
      protein: values.protein,
      fat: values.fat,
      carbs: values.carbs,
    };
    return { kind: "add", key, body, entry };
  });
}

/** True while a refused add, or something waiting on it, holds the op back. */
export function isHeld<E>(op: OutboxOp<E>): boolean {
  return isCreate(op) ? op.failed !== undefined : isLocalId(op.id);
}

/** The next op that can go to the server, in the order they were made. */
export function nextToSend<E>(ops: readonly OutboxOp<E>[]): OutboxOp<E> | null {
  return ops.find((op) => !isHeld(op)) ?? null;
}

/**
 * The day as it will be once the queue is sent: the server's rows for `date` with queued adds,
 * edits and deletes applied, each touched row marked. Leftover local rows and marks are dropped first.
 */
export function overlay<E extends QueuedRow>(rows: readonly E[], date: string, ops: readonly OutboxOp<E>[]): E[] {
  // Marks come from the queue alone: a row it no longer touches shows as sent.
  let list = rows.filter((row) => !isLocalId(row.id)).map((row) => {
    if (!row.queued) return row;
    const { queued: _queued, queuedNote: _note, ...rest } = row;
    return rest as E;
  });
  const mark = (entry: E, failed?: string): E => (failed
    ? { ...entry, queued: "failed", queuedNote: failed }
    : { ...entry, queued: "waiting", queuedNote: undefined });
  for (const op of ops) {
    if (isCreate(op)) {
      if (op.entry.localDate !== date || list.some((row) => row.idempotencyKey === op.key)) continue;
      list.push(mark(op.entry, op.failed));
      continue;
    }
    const index = list.findIndex((row) => row.id === op.id);
    if (op.kind === "delete") {
      if (index >= 0) list = list.filter((_, at) => at !== index);
    } else if (op.entry.localDate !== date) {
      if (index >= 0) list = list.filter((_, at) => at !== index);
    } else if (index >= 0) {
      const failed = list[index].queued === "failed" ? list[index].queuedNote : undefined;
      list = list.map((row, at) => (at === index ? mark(op.entry, failed) : row));
    } else {
      list.push(mark(op.entry));
    }
  }
  return list;
}

export interface QueueSummary {
  /** Entries with something waiting to send. */
  waiting: number;
  /** Adds the server refused. */
  failed: number;
  /** Times of the waiting adds, earliest first. */
  addedAt: string[];
}

export function summarize<E extends QueuedRow>(ops: readonly OutboxOp<E>[]): QueueSummary {
  const waiting = new Set<string>();
  const failed = new Set<string>();
  const addedAt: string[] = [];
  for (const op of ops) {
    const id = opEntryId(op);
    if (isCreate(op) && op.failed) {
      failed.add(id);
      continue;
    }
    if (failed.has(id)) continue;
    waiting.add(id);
    if (isCreate(op)) addedAt.push(op.entry.time);
  }
  return { waiting: waiting.size, failed: failed.size, addedAt: addedAt.sort() };
}
