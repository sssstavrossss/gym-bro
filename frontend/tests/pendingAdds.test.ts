import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  reachable: null as (() => void) | null,
  addLogEntry: vi.fn(),
  listLogEntries: vi.fn(),
}));

vi.mock("../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api")>()),
  addLogEntry: api.addLogEntry,
  listLogEntries: api.listLogEntries,
  whenReachable: (listener: () => void) => { api.reachable = listener; },
}));

const { loadToday, log, saveQuickAdd } = await import("../src/state/log");
type PendingAdd = import("../src/state/log").PendingAdd;

function pending(key: string): PendingAdd {
  return {
    idempotencyKey: key,
    localDate: "2026-11-14",
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
    localDate: "2026-11-14",
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
  log.pending = [];
  log.entries = [];
  log.unreachable = false;
  vi.clearAllMocks();
});

it("drops a pending add whose saved entry was deleted instead of retrying it forever", async () => {
  log.pending = [pending("gone")];
  api.addLogEntry.mockResolvedValue(row("gone", "2026-11-14T09:00:00Z"));

  const result = await saveQuickAdd(log.pending[0]);

  expect(result.ok).toBe(false);
  expect(log.pending).toEqual([]);
});

it("stops showing a pending add once today's list has it", async () => {
  // readPending() starts from storage, which is empty without an account, so seed after it runs.
  api.listLogEntries.mockImplementation(async () => {
    log.pending = [pending("landed"), pending("still-waiting")];
    return { localDate: "2026-11-14", entries: [row("landed")] };
  });

  await loadToday();

  expect(log.entries.map((entry) => entry.idempotencyKey)).toEqual(["landed"]);
  expect(log.pending.map((add) => add.idempotencyKey)).toEqual(["still-waiting"]);
});

it("lowers the unreachable banner when the server answers again, unless an add is still waiting", () => {
  expect(api.reachable).toBeTypeOf("function");

  log.unreachable = true;
  log.pending = [pending("waiting")];
  api.reachable!();
  expect(log.unreachable).toBe(true);

  log.pending = [];
  api.reachable!();
  expect(log.unreachable).toBe(false);
});
