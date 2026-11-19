import { describe, expect, it } from "vitest";
import { timeInZone } from "../src/lib/dates";
import { searchKept } from "../src/lib/foodSearch";
import { failedNote, offlineRows, sentToast, updatedText } from "../src/lib/offline";

const now = new Date(2026, 10, 19, 15, 0).getTime();

describe("updatedText", () => {
  it("shows the time for today, the weekday this week, and the date before that", () => {
    expect(updatedText(new Date(2026, 10, 19, 14, 32).getTime(), now)).toBe("14:32");
    expect(updatedText(new Date(2026, 10, 17, 9, 5).getTime(), now)).toMatch(/^Tue 09:05$/);
    expect(updatedText(new Date(2026, 10, 2, 9, 5).getTime(), now)).toMatch(/^2 Nov 09:05$/);
  });
});

describe("offlineRows", () => {
  it("says nothing is waiting when the queue is empty", () => {
    const rows = offlineRows({ waiting: 0, failed: 0, addedAt: [] }, "14:32");
    expect(rows.map((row) => row.title)).toEqual([
      "Nothing waiting to send",
      "Weight and Progress are from 14:32",
      "Needs a connection",
    ]);
  });

  it("lists the waiting foods and the ones that couldn't send", () => {
    const rows = offlineRows({ waiting: 2, failed: 1, addedAt: ["08:10", "12:40"] }, "14:32");
    expect(rows[0]).toMatchObject({ title: "2 foods waiting to send" });
    expect(rows[0].detail).toContain("Macros already count them.");
    expect(rows[1]).toMatchObject({ title: "1 food couldn't send" });
  });
});

describe("sentToast", () => {
  it("counts what went and what didn't", () => {
    expect(sentToast({ sent: 2, failed: 0, dropped: [] })).toBe("Back online. 2 foods sent.");
    expect(sentToast({ sent: 1, failed: 0, dropped: [] })).toBe("Back online. 1 food sent.");
    expect(sentToast({ sent: 1, failed: 1, dropped: [] })).toContain("1 food couldn't send");
  });
});

it("failedNote keeps the server's reason and says what Save does", () => {
  expect(failedNote("That food was deleted.")).toBe("Couldn't send: that food was deleted. Save keeps it as a quick add.");
});

it("timeInZone gives the wall clock in that zone", () => {
  expect(timeInZone("UTC", new Date(Date.UTC(2026, 10, 19, 7, 5)))).toBe("07:05");
  expect(timeInZone("Asia/Kolkata", new Date(Date.UTC(2026, 10, 19, 7, 5)))).toBe("12:35");
});

describe("searchKept", () => {
  const recents = [{ id: "a", name: "Skyr naturell", brand: "Q" }, { id: "b", name: "Banana", brand: null }];
  const mine = [{ id: "a", name: "Skyr naturell", brand: "Q" }, { id: "c", name: "Crème brûlée", brand: "Home" }];

  it("needs every word, ignores accents and case, and lists a food once", () => {
    expect(searchKept("skyr", [recents, mine]).map((food) => food.id)).toEqual(["a"]);
    expect(searchKept("creme home", [recents, mine]).map((food) => food.id)).toEqual(["c"]);
    expect(searchKept("banana q", [recents, mine])).toEqual([]);
  });
});
