import { describe, expect, it } from "vitest";
import {
  asQuickAdd,
  copyOp,
  createAsPatch,
  dropCreate,
  localId,
  markFailed,
  nextToSend,
  overlay,
  queueCreate,
  queueDelete,
  queuePatch,
  queueRestore,
  rewriteId,
  settle,
  summarize,
  type OutboxOp,
  type QueuedRow,
} from "../src/lib/outbox";

interface Row extends QueuedRow {
  name: string;
  kcal: number;
}

function row(id: string, time: string, extra: Partial<Row> = {}): Row {
  return { id, idempotencyKey: `key-${id}`, localDate: "2026-11-19", time, name: id, kcal: 100, ...extra };
}

function add(key: string, time: string, extra: Partial<Row> = {}): OutboxOp<Row> {
  const entry = row(localId(key), time, { idempotencyKey: key, ...extra });
  return {
    kind: "add",
    key,
    body: { idempotencyKey: key, localDate: entry.localDate, timeZone: "Europe/Oslo", time, name: entry.name, kcal: entry.kcal, protein: 1, fat: 1, carbs: 1 },
    entry,
  };
}

const date = "2026-11-19";

describe("outbox queue", () => {
  it("folds an edit of an unsent add into the add itself", () => {
    const ops = queuePatch([add("a", "16:00")], localId("a"), { kcal: 250 }, row(localId("a"), "16:00", { idempotencyKey: "a", kcal: 250 }));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "add", body: { kcal: 250 }, entry: { kcal: 250 } });
  });

  it("merges two edits of a server entry into one", () => {
    let ops = queuePatch<Row>([], "s1", { kcal: 200 }, row("s1", "08:00", { kcal: 200 }));
    ops = queuePatch(ops, "s1", { time: "09:00" }, row("s1", "09:00", { kcal: 200 }));
    expect(ops).toEqual([{ kind: "patch", id: "s1", body: { kcal: 200, time: "09:00" }, entry: row("s1", "09:00", { kcal: 200 }) }]);
  });

  it("drops an unsent add on delete, and undo puts it back with its edits", () => {
    let ops: OutboxOp<Row>[] = [add("a", "16:00"), add("b", "18:40")];
    const removed = queueDelete(ops, ops[0].entry);
    expect(removed.ops.map((op) => op.kind === "add" && op.key)).toEqual(["b"]);
    ops = queueRestore(removed.ops, ops[0].entry, removed.undo);
    expect(ops.map((op) => op.kind === "add" && op.key)).toEqual(["b", "a"]);
  });

  it("takes back an unsent delete on undo, and queues a restore once the delete went", () => {
    const entry = row("s1", "08:00");
    const deleted = queueDelete<Row>([], entry);
    expect(deleted.ops).toEqual([{ kind: "delete", id: "s1", entry }]);
    expect(queueRestore(deleted.ops, entry, deleted.undo)).toEqual([]);
    expect(queueRestore([], entry, [])).toEqual([{ kind: "restore", id: "s1", entry }]);
  });

  it("holds an edit of a copy until the copy has its server id", () => {
    const copy: OutboxOp<Row> = { kind: "copy", key: "c", sourceId: "s1", localDate: date, timeZone: "Europe/Oslo", entry: row(localId("c"), "08:00", { idempotencyKey: "c" }) };
    let ops = queuePatch([copy], localId("c"), { time: "10:00" }, row(localId("c"), "10:00", { idempotencyKey: "c" }));
    expect(ops).toHaveLength(2);
    expect(nextToSend(ops)).toBe(copy);
    expect(nextToSend(ops.slice(1))).toBeNull();
    ops = rewriteId(ops.slice(1), localId("c"), "s9");
    expect(nextToSend(ops)).toMatchObject({ kind: "patch", id: "s9", entry: { id: "s9" } });
  });

  it("skips a refused add so the rest still send", () => {
    const ops = markFailed([add("a", "16:00"), add("b", "18:40")], "a", "Food not found.");
    expect(nextToSend(ops)).toMatchObject({ key: "b" });
    expect(nextToSend(dropCreate(ops, "b"))).toBeNull();
  });

  it("sends a refused add again as a quick add", () => {
    const ops = asQuickAdd(markFailed([add("a", "16:00")], "a", "Food not found."), "a", { name: "Oats", kcal: 380, protein: 13, fat: 7, carbs: 60 }, row(localId("a"), "16:00", { idempotencyKey: "a", name: "Oats" }));
    expect(ops[0]).toMatchObject({ kind: "add", body: { name: "Oats", kcal: 380, time: "16:00", localDate: date }, entry: { name: "Oats" } });
    expect(ops[0]).not.toHaveProperty("failed");
    expect(ops[0]).not.toHaveProperty("body.foodId");
  });

  it("forgets adds the server already has and moves their edits onto the server id", () => {
    const ops = settle([add("a", "16:00"), { kind: "patch", id: localId("a"), body: { time: "17:00" }, entry: row(localId("a"), "17:00") }] as OutboxOp<Row>[], [row("s5", "16:00", { idempotencyKey: "a" })]);
    expect(ops).toEqual([{ kind: "patch", id: "s5", body: { time: "17:00" }, entry: { ...row(localId("a"), "17:00"), id: "s5" } }]);
  });

  it("copies an unsent entry without waiting on it", () => {
    const entry = row(localId("n"), "16:00", { idempotencyKey: "n" });
    const server: OutboxOp<Row> = { kind: "copy", key: "c1", sourceId: "s1", localDate: date, timeZone: "Europe/Oslo", entry };
    expect(copyOp([], "s1", "n", "2026-11-20", "Europe/Oslo", entry)).toMatchObject({ kind: "copy", sourceId: "s1" });
    expect(copyOp([server], localId("c1"), "n", "2026-11-20", "Europe/Oslo", entry)).toMatchObject({ kind: "copy", sourceId: "s1", localDate: "2026-11-20" });
    expect(copyOp([add("a", "16:00")], localId("a"), "n", "2026-11-20", "Europe/Oslo", entry)).toMatchObject({
      kind: "add",
      key: "n",
      body: { idempotencyKey: "n", localDate: "2026-11-20", time: "16:00" },
    });
    expect(copyOp([], localId("gone"), "n", date, "Europe/Oslo", entry)).toBeNull();
  });

  it("turns an add into the edit of the entry it made, food or quick", () => {
    expect(createAsPatch({ idempotencyKey: "k", localDate: date, timeZone: "Europe/Oslo", time: "08:00", kcal: 1, protein: 1, fat: 1, carbs: 1, foodId: "f", amount: 40, unit: "g" }))
      .toEqual({ amount: 40, unit: "g", localDate: date, timeZone: "Europe/Oslo", time: "08:00" });
    expect(createAsPatch({ idempotencyKey: "k", localDate: date, timeZone: "Europe/Oslo", time: null, name: "Bar", kcal: 200, protein: 10, fat: 5, carbs: 20 }))
      .toEqual({ name: "Bar", kcal: 200, protein: 10, fat: 5, carbs: 20, localDate: date, timeZone: "Europe/Oslo" });
  });

  it("replaces an add with the same key instead of queueing it twice", () => {
    const ops = queueCreate([add("a", "16:00")], add("a", "16:30") as never);
    expect(ops).toHaveLength(1);
    expect(ops[0].entry.time).toBe("16:30");
  });
});

describe("outbox overlay", () => {
  it("shows the day as it will be once sent, with every touched row marked", () => {
    const server = [row("s1", "08:00"), row("s2", "12:00"), row(localId("stale"), "13:00")];
    const ops: OutboxOp<Row>[] = [
      add("a", "16:00"),
      { kind: "patch", id: "s1", body: { kcal: 300 }, entry: row("s1", "08:00", { kcal: 300 }) },
      { kind: "delete", id: "s2", entry: server[1] },
      add("other-day", "10:00", { localDate: "2026-11-20" }),
    ];
    const shown = overlay(server, date, markFailed(ops, "a", "Food not found."));
    expect(shown.map((entry) => [entry.id, entry.queued, entry.kcal])).toEqual([
      ["s1", "waiting", 300],
      [localId("a"), "failed", 100],
    ]);
    expect(shown[1].queuedNote).toBe("Food not found.");
  });

  it("does not show an add twice once the server has it", () => {
    const shown = overlay([row("s5", "16:00", { idempotencyKey: "a" })], date, [add("a", "16:00")]);
    expect(shown.map((entry) => entry.id)).toEqual(["s5"]);
  });

  it("moves an entry edited onto another day", () => {
    const moved = row("s1", "08:00", { localDate: "2026-11-18" });
    const ops: OutboxOp<Row>[] = [{ kind: "patch", id: "s1", body: { localDate: "2026-11-18" }, entry: moved }];
    expect(overlay([row("s1", "08:00")], date, ops)).toEqual([]);
    expect(overlay([], "2026-11-18", ops).map((entry) => entry.id)).toEqual(["s1"]);
  });

  it("brings back a restored entry", () => {
    const entry = row("s1", "08:00");
    expect(overlay([], date, [{ kind: "restore", id: "s1", entry }])).toEqual([{ ...entry, queued: "waiting", queuedNote: undefined }]);
  });
});

describe("outbox summary", () => {
  it("counts entries, not requests, and keeps refused adds apart", () => {
    const ops: OutboxOp<Row>[] = markFailed([
      add("b", "18:40"),
      add("a", "16:00"),
      { kind: "patch", id: localId("x"), body: {}, entry: row(localId("x"), "09:00") },
      { kind: "patch", id: "s1", body: { kcal: 1 }, entry: row("s1", "08:00") },
      { kind: "delete", id: "s1", entry: row("s1", "08:00") },
      add("x", "09:00"),
    ], "x", "Food not found.");
    expect(summarize(ops)).toEqual({ waiting: 4, failed: 1, addedAt: ["16:00", "18:40"] });
  });
});
