import { afterEach, expect, it } from "vitest";
import { dayTotals, log, type LogEntry, type PendingAdd } from "../src/state/log";

const saved: LogEntry = {
  id: "saved-1",
  localDate: "2026-10-30",
  time: "08:15",
  timeZone: "UTC",
  name: "Fictional bar",
  amount: 1,
  unit: "",
  grams: null,
  kcal: 200,
  protein: 10,
  fat: 5,
  carbs: 20,
  source: "quick",
  idempotencyKey: "saved-key",
};

const pending: PendingAdd = {
  idempotencyKey: "pending-key",
  localDate: "2026-10-30",
  time: "08:20",
  timeZone: "UTC",
  name: "Fictional shake",
  kcal: 80,
  protein: 4,
  fat: 2,
  carbs: 8,
};

afterEach(() => {
  log.entries = [];
  log.pending = [];
});

it("sums saved entries and leaves pending rows out of today's numbers", () => {
  log.entries = [saved];
  log.pending = [pending];
  expect(dayTotals()).toEqual({ kcal: 200, p: 10, f: 5, c: 20 });
});
