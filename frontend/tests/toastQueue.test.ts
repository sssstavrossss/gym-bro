import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, frontTimer, isThrow, mergedText, type QueuedToast } from "../src/lib/toastQueue";

describe("mergedText", () => {
  it("counts foods and sums kcal", () => {
    expect(mergedText({ kind: "add", count: 2, kcal: 237 })).toBe("Added 2 foods · 237 kcal");
    expect(mergedText({ kind: "add", count: 1, kcal: 1200 })).toBe("Added 1 food · 1,200 kcal");
    expect(mergedText({ kind: "add", count: 3 })).toBe("Added 3 foods");
  });
  it("counts deleted items", () => {
    expect(mergedText({ kind: "delete", count: 4 })).toBe("Deleted 4 items");
  });
});

describe("enqueue", () => {
  it("puts the first toast in front and restarts its clock", () => {
    const { queue, restart } = enqueue([], { text: "Saved" }, 1);
    expect(queue).toEqual([{ text: "Saved", id: 1 }]);
    expect(restart).toBe(true);
  });

  it("queues a different kind behind without touching the front's clock", () => {
    const first = enqueue([], { text: "Added Egg · 70 kcal", merge: { kind: "add", count: 1, kcal: 70 } }, 1).queue;
    const { queue, restart } = enqueue(first, { text: "Saved Plate" }, 2);
    expect(queue.map((t) => t.id)).toEqual([1, 2]);
    expect(restart).toBe(false);
  });

  it("merges back-to-back adds into the front, restarts it, and Undo takes back both", () => {
    const undone: string[] = [];
    let queue: QueuedToast[] = enqueue([], {
      text: "Added Egg · 70 kcal",
      action: { label: "Undo", run: () => undone.push("egg") },
      merge: { kind: "add", count: 1, kcal: 70 },
    }, 1).queue;
    const next = enqueue(queue, {
      text: "Added Toast · 167 kcal",
      action: { label: "Undo", run: () => undone.push("toast") },
      merge: { kind: "add", count: 1, kcal: 167 },
    }, 2);
    queue = next.queue;
    expect(next.restart).toBe(true);
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(1);
    expect(queue[0].text).toBe("Added 2 foods · 237 kcal");
    queue[0].action!.run();
    expect(undone).toEqual(["egg", "toast"]);
  });

  it("merges into a waiting toast without restarting the front", () => {
    let queue = enqueue([], { text: "Saved Plate" }, 1).queue;
    queue = enqueue(queue, { text: "Deleted Egg", merge: { kind: "delete", count: 1 } }, 2).queue;
    const next = enqueue(queue, { text: "Deleted Toast", merge: { kind: "delete", count: 1 } }, 3);
    expect(next.restart).toBe(false);
    expect(next.queue.map((t) => t.text)).toEqual(["Saved Plate", "Deleted 2 items"]);
  });

  it("an Undo arriving behind others cuts the ones ahead short", () => {
    const undo = { label: "Undo", run: () => {} };
    let queue = enqueue([], { text: "Saved Plate" }, 1).queue;
    queue = enqueue(queue, { text: "Target saved" }, 2).queue;
    expect(queue.some((t) => t.short)).toBe(false);
    const next = enqueue(queue, { text: "Deleted Egg", action: undo, merge: { kind: "delete", count: 1 } }, 3);
    expect(next.cut).toBe(true);
    expect(next.restart).toBe(false);
    expect(next.queue.map((t) => [t.id, t.short ?? false])).toEqual([[1, true], [2, true], [3, false]]);
  });

  it("a toast without Undo, or one alone, cuts nothing", () => {
    const undo = { label: "Undo", run: () => {} };
    expect(enqueue([], { text: "Deleted Egg", action: undo }, 1).cut).toBe(false);
    const queue = enqueue([], { text: "Deleted Egg", action: undo }, 1).queue;
    const next = enqueue(queue, { text: "Saved Plate" }, 2);
    expect(next.cut).toBe(false);
    expect(next.queue[0].short).toBeUndefined();
  });

  it("doesn't merge different kinds, errors, or toasts that aren't back to back", () => {
    const add = { text: "Added Egg", merge: { kind: "add" as const, count: 1 } };
    const del = { text: "Deleted Egg", merge: { kind: "delete" as const, count: 1 } };
    expect(enqueue(enqueue([], add, 1).queue, del, 2).queue).toHaveLength(2);
    expect(enqueue(enqueue([], add, 1).queue, { ...add, error: true }, 2).queue).toHaveLength(2);
    let queue = enqueue([], add, 1).queue;
    queue = enqueue(queue, { text: "Saved Plate" }, 2).queue;
    expect(enqueue(queue, add, 3).queue).toHaveLength(3);
  });
});

describe("frontTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ends after its life", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    vi.advanceTimersByTime(3999);
    expect(end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("pauses while held and resumes with the time that was left", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    vi.advanceTimersByTime(3000);
    clock.pause();
    vi.advanceTimersByTime(10_000);
    expect(end).not.toHaveBeenCalled();
    clock.resume();
    vi.advanceTimersByTime(999);
    expect(end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("a new front toast under a held finger waits for the release, then gets its full time", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    clock.pause();
    clock.start();
    vi.advanceTimersByTime(10_000);
    expect(end).not.toHaveBeenCalled();
    clock.resume();
    vi.advanceTimersByTime(4000);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("shorten leaves at most that long, and never lengthens", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    vi.advanceTimersByTime(1000);
    clock.shorten(1000);
    vi.advanceTimersByTime(999);
    expect(end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    const other = frontTimer(4000, late);
    other.start();
    vi.advanceTimersByTime(3500);
    other.shorten(1000);
    vi.advanceTimersByTime(500);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("a held toast that is cut short gets the short time once let go", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    clock.pause();
    clock.shorten(1000);
    vi.advanceTimersByTime(5000);
    expect(end).not.toHaveBeenCalled();
    clock.resume();
    vi.advanceTimersByTime(1000);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("stop clears the clock and the hold", () => {
    const end = vi.fn();
    const clock = frontTimer(4000, end);
    clock.start();
    clock.pause();
    clock.stop();
    clock.start();
    vi.advanceTimersByTime(4000);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("isThrow", () => {
  it("throws on a long drag in any direction", () => {
    expect(isThrow(70, 0, 1000)).toBe(true);
    expect(isThrow(0, -70, 1000)).toBe(true);
    expect(isThrow(-50, 50, 1000)).toBe(true);
  });
  it("throws on a quick short flick", () => {
    expect(isThrow(30, 0, 40)).toBe(true);
  });
  it("keeps the toast on a slow small drag or a tap", () => {
    expect(isThrow(30, 0, 400)).toBe(false);
    expect(isThrow(3, 2, 20)).toBe(false);
  });
});
