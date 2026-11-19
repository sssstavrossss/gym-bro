import { afterEach, expect, it } from "vitest";
import { dayTotals, log, type LogEntry } from "../src/state/log";

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
  foodId: null,
  groupId: null,
  idempotencyKey: "saved-key",
};

const waiting: LogEntry = {
  ...saved,
  id: "local:waiting-key",
  time: "08:20",
  name: "Fictional shake",
  kcal: 80,
  protein: 4,
  fat: 2,
  carbs: 8,
  idempotencyKey: "waiting-key",
  queued: "waiting",
};

const refused: LogEntry = { ...waiting, id: "local:refused-key", idempotencyKey: "refused-key", queued: "failed", kcal: 500 };

afterEach(() => {
  log.entries = [];
});

it("counts an entry waiting to send, and leaves out one the server refused", () => {
  log.entries = [saved, waiting, refused];
  expect(dayTotals()).toEqual({ kcal: 280, p: 14, f: 7, c: 28 });
});
