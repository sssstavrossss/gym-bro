import { reactive } from "vue";
import {
  addLogEntry,
  ApiError,
  copyLogEntries,
  deleteLogEntry,
  patchLogEntry,
  restoreLogEntry,
  type LogEntryResponse,
} from "../api";
import {
  createAsPatch,
  dropCreate,
  isCreate,
  localId,
  markFailed,
  nextToSend,
  opEntryId,
  rewriteId,
  type CreateOp,
  type OutboxOp,
} from "../lib/outbox";
import type { LogEntry } from "./log";

export type QueuedOp = OutboxOp<LogEntry>;

/**
 * Log changes waiting for the server, kept in localStorage per account so they survive the
 * app being closed. The rules live in lib/outbox.ts; this file keeps and sends the list.
 */
export const outbox = reactive({
  ops: [] as QueuedOp[],
  sending: false,
});

let account = "";

function storageKey(): string {
  return `gymbro-outbox:${account}`;
}

function read(): QueuedOp[] {
  if (!account) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

export function useOutboxAccount(id: string): void {
  account = id;
  outbox.ops = read();
}

export function setOps(ops: QueuedOp[]): void {
  outbox.ops = ops;
  if (!account) return;
  try {
    if (ops.length) localStorage.setItem(storageKey(), JSON.stringify(ops));
    else localStorage.removeItem(storageKey());
  } catch {
    // Storage is full or blocked: the queue still lives until the app closes.
  }
}

/** Another tab changed the queue. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (account && event.key === storageKey()) outbox.ops = read();
  });
}

export function hasSendable(): boolean {
  return nextToSend(outbox.ops) !== null;
}

/** 4xx the server means, as opposed to "not now" (sign-in, timeout, rate limit). */
function refused(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
}

export interface SendResult {
  /** Entries whose changes all reached the server in this pass. */
  sent: number;
  /** Changes the server refused and the queue dropped (an edit of an entry deleted elsewhere). */
  dropped: { name: string; message: string }[];
  /** Adds the server refused, kept as "couldn't send". */
  failed: number;
  /** The server stopped answering part way. */
  stopped: boolean;
}

export interface SendHooks {
  /** A queued add now has its server id. Lets an open sheet or selection follow it. */
  created(localId: string, serverId: string): void;
}

/** Sends queued changes in order until the queue is empty, held, or the server stops answering. */
export async function sendQueued(hooks: SendHooks): Promise<SendResult> {
  const result: SendResult = { sent: 0, dropped: [], failed: 0, stopped: false };
  if (outbox.sending || !hasSendable()) return result;
  outbox.sending = true;
  const touched = new Set<string>();
  try {
    const run = () => sendAll(hooks, result, touched);
    if (typeof navigator !== "undefined" && navigator.locks) {
      // Two tabs must not send the same queue at once.
      await navigator.locks.request("gymbro-outbox", { ifAvailable: true }, async (lock) => {
        if (lock) {
          outbox.ops = read();
          await run();
        }
      });
    } else {
      await run();
    }
  } finally {
    outbox.sending = false;
  }
  const waiting = new Set(outbox.ops.map(opEntryId));
  result.sent = [...touched].filter((id) => !waiting.has(id)).length;
  return result;
}

async function sendAll(hooks: SendHooks, result: SendResult, touched: Set<string>): Promise<void> {
  for (let op = nextToSend(outbox.ops); op; op = nextToSend(outbox.ops)) {
    try {
      const id = await sendOne(op, hooks);
      if (id) touched.add(id);
    } catch (error) {
      if (!refused(error)) {
        result.stopped = true;
        return;
      }
      if (isCreate(op)) {
        setOps(markFailed(outbox.ops, op.key, error.message));
        result.failed += 1;
      } else {
        setOps(outbox.ops.filter((row) => row !== op));
        result.dropped.push({ name: op.entry.name, message: error.message });
      }
    }
  }
}

/** Sends one op and takes it off the queue. Returns the id of the entry that reached the server, if one did. */
async function sendOne(op: QueuedOp, hooks: SendHooks): Promise<string | null> {
  switch (op.kind) {
    case "add":
      return finishCreate(op, await addLogEntry(op.body), hooks);
    case "copy": {
      const body = await copyLogEntries({ localDate: op.localDate, timeZone: op.timeZone, items: [{ id: op.sourceId, idempotencyKey: op.key }] });
      return finishCreate(op, body.entries[0] ?? null, hooks);
    }
    case "patch":
      await patchLogEntry(op.id, op.body);
      break;
    case "delete":
      try {
        await deleteLogEntry(op.id);
      } catch (error) {
        // Already gone on the server is what the delete wanted.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      break;
    case "restore":
      await restoreLogEntry(op.id);
      break;
  }
  // Leave an op that changed while it was on its way (an edit merged into it): it goes again.
  setOps(outbox.ops.filter((row) => row !== op));
  return op.id;
}

function finishCreate(op: CreateOp<LogEntry>, row: LogEntryResponse | null, hooks: SendHooks): string | null {
  const local = localId(op.key);
  if (!row || row.deletedAt) {
    // The key was saved before and deleted since: there is nothing to bring back.
    setOps(dropCreate(outbox.ops, op.key));
    return null;
  }
  const current = outbox.ops.find((item) => isCreate(item) && item.key === op.key);
  let ops = outbox.ops;
  if (!current) {
    // Deleted on the phone while the add was on its way.
    ops = [...ops, { kind: "delete", id: row.id, entry: { ...op.entry, id: row.id } }];
  } else if (current !== op && current.kind === "add") {
    // Edited on the phone while the add was on its way.
    ops = ops.map((item) => (item === current ? { kind: "patch", id: row.id, body: createAsPatch(current.body), entry: { ...current.entry, id: row.id } } : item));
  } else {
    ops = ops.filter((item) => item !== current);
  }
  setOps(rewriteId(ops, local, row.id));
  hooks.created(local, row.id);
  return row.id;
}
