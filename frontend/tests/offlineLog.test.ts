import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  addLogEntry: vi.fn(),
  listLogEntries: vi.fn(),
}));

vi.mock("../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api")>()),
  addLogEntry: api.addLogEntry,
  listLogEntries: api.listLogEntries,
}));

const { ApiError, ServerUnreachable } = await import("../src/api");
const { todayIso } = await import("../src/lib/dates");
const { dayTotals, loadToday, log, saveQuickAdd, sendQueue } = await import("../src/state/log");
const { connection } = await import("../src/state/connection");
const { outbox, setOps } = await import("../src/state/outbox");
const { ui } = await import("../src/ui");

const today = todayIso();

beforeAll(() => {
  // The toast timer is all the log state needs from the window.
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

beforeEach(() => {
  // Today is open, as it is once the app has started.
  log.date = today;
});

function input(key: string) {
  return {
    idempotencyKey: key,
    localDate: today,
    time: "08:00",
    timeZone: "UTC",
    name: "Fictional shake",
    kcal: 80,
    protein: 4,
    fat: 2,
    carbs: 10,
  };
}

function row(key: string, deletedAt: string | null = null) {
  return {
    id: `id-${key}`,
    localDate: today,
    time: "08:00",
    timeZone: "UTC",
    name: "Fictional shake",
    amount: 1,
    unit: "",
    grams: null,
    kcal: 80,
    protein: 4,
    fat: 2,
    carbs: 10,
    source: "quick",
    foodId: null,
    groupId: null,
    idempotencyKey: key,
    deletedAt,
  };
}

afterEach(() => {
  setOps([]);
  log.entries = [];
  log.date = "";
  connection.offline = false;
  ui.toast = null;
  vi.clearAllMocks();
});

it("keeps an add on the phone when the server can't be reached, and counts it", async () => {
  api.addLogEntry.mockRejectedValue(new ServerUnreachable());
  api.listLogEntries.mockRejectedValue(new ServerUnreachable());

  const result = await saveQuickAdd(input("shake"));

  expect(result).toMatchObject({ ok: true, queued: true });
  expect(outbox.ops).toHaveLength(1);
  expect(log.entries).toHaveLength(1);
  expect(log.entries[0]).toMatchObject({ id: "local:shake", queued: "waiting" });
  expect(dayTotals().kcal).toBe(80);
});

it("queues straight away while offline, without asking the server", async () => {
  connection.offline = true;

  const result = await saveQuickAdd(input("offline"));

  expect(result).toMatchObject({ ok: true, queued: true });
  expect(api.addLogEntry).not.toHaveBeenCalled();
  expect(log.entries[0]?.queued).toBe("waiting");
});

it("sends the queue under the same key once the server answers, and says so", async () => {
  connection.offline = true;
  await saveQuickAdd(input("later"));
  connection.offline = false;
  api.addLogEntry.mockResolvedValue(row("later"));
  api.listLogEntries.mockResolvedValue({ localDate: today, entries: [row("later")] });

  await sendQueue();

  expect(api.addLogEntry).toHaveBeenCalledTimes(1);
  expect(api.addLogEntry.mock.calls[0][0]).toMatchObject({ idempotencyKey: "later", time: "08:00" });
  expect(outbox.ops).toEqual([]);
  expect(log.entries.map((entry) => [entry.id, entry.queued])).toEqual([["id-later", undefined]]);
  expect(ui.toast?.text).toBe("Back online. 1 food sent.");
});

it("keeps an add the server refuses as couldn't send, out of the totals", async () => {
  connection.offline = true;
  await saveQuickAdd(input("refused"));
  connection.offline = false;
  api.addLogEntry.mockRejectedValue(new ApiError("That food was deleted.", 400));
  api.listLogEntries.mockResolvedValue({ localDate: today, entries: [] });

  await sendQueue();

  expect(log.entries).toHaveLength(1);
  expect(log.entries[0]).toMatchObject({ queued: "failed", queuedNote: "That food was deleted." });
  expect(dayTotals().kcal).toBe(0);
  expect(ui.toast?.text).toContain("1 food couldn't send");
});

it("stops when the server goes away again and keeps the rest", async () => {
  connection.offline = true;
  await saveQuickAdd(input("first"));
  await saveQuickAdd(input("second"));
  connection.offline = false;
  api.addLogEntry.mockResolvedValueOnce(row("first")).mockRejectedValueOnce(new ServerUnreachable());
  api.listLogEntries.mockResolvedValue({ localDate: today, entries: [row("first")] });

  await sendQueue();

  expect(outbox.ops.map((op) => op.kind === "add" && op.key)).toEqual(["second"]);
  expect(log.entries.map((entry) => entry.queued ?? "sent")).toEqual(["sent", "waiting"]);
});

it("drops a queued add once today's list from the server has it", async () => {
  connection.offline = true;
  await saveQuickAdd(input("landed"));
  await saveQuickAdd(input("still-waiting"));
  connection.offline = false;
  api.listLogEntries.mockResolvedValue({ localDate: today, entries: [row("landed")] });

  await loadToday();

  expect(outbox.ops.map((op) => op.kind === "add" && op.key)).toEqual(["still-waiting"]);
  expect(log.entries.map((entry) => entry.id)).toEqual(["id-landed", "local:still-waiting"]);
});

it("drops a queued add whose key the server already deleted", async () => {
  connection.offline = true;
  await saveQuickAdd(input("gone"));
  connection.offline = false;
  api.addLogEntry.mockResolvedValue(row("gone", "2026-11-14T09:00:00Z"));
  api.listLogEntries.mockResolvedValue({ localDate: today, entries: [] });

  await sendQueue();

  expect(outbox.ops).toEqual([]);
  expect(log.entries).toEqual([]);
});
