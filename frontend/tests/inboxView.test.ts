import { describe, expect, it } from "vitest";
import { noteDate, recentNotes } from "../src/lib/inboxView";

const item = (id: number, createdAt: string, readAt: string | null, type = "recalculate") => ({
  id, type, title: "Time to recalculate your target", body: "", link: "/today?recalculate=1", createdAt, readAt,
});

describe("recent notifications", () => {
  it("dates the Monday reminder in the person's zone", () => {
    expect(noteDate("2026-11-15T23:00:00Z", "Europe/Oslo")).toBe("16 Nov");
    expect(noteDate("2026-11-15T23:00:00Z", "UTC")).toBe("15 Nov");
  });

  it("lists the newest three, an open reminder as on Today", () => {
    const items = [
      item(1, "2026-10-25T23:00:00Z", "2026-10-27T08:00:00Z"),
      item(4, "2026-11-15T23:00:00Z", null),
      item(2, "2026-11-01T23:00:00Z", "2026-11-02T08:00:00Z"),
      item(3, "2026-11-08T23:00:00Z", "2026-11-10T08:00:00Z"),
      item(5, "2026-11-14T10:00:00Z", null, "other"),
    ];
    const recent = recentNotes(items, "Europe/Oslo");
    expect(recent.map((note) => note.id)).toEqual([4, 5, 3]);
    expect(recent[0]).toEqual({ id: 4, label: "Recalculate reminder", state: "today", date: "16 Nov" });
    expect(recent[1].state).toBe("new");
    expect(recent[1].label).toBe("Time to recalculate your target");
    expect(recent[2].state).toBe("done");
    expect(recentNotes([], "UTC")).toEqual([]);
  });
});
