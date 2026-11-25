import { describe, expect, it } from "vitest";
import { addAction, defaultFan, fanSummary, dropSpot, fanShown, fanSteps, placeAction, readFanLayout, stepAction, unusedActions, writeFanLayout, type FanLayout, type FanRow } from "../src/lib/fanPages";

const mine: FanLayout = [["search", "scan", "describe", "quick", "weight"], ["recipe", "groups"]];

describe("reading and saving a fan layout", () => {
  it("is the default two pages until one is saved", () => {
    expect(readFanLayout([])).toEqual([["search", "scan", "describe", "quick", "weight"], ["recipe", "food", "recipes", "mine", "groups"]]);
    expect(writeFanLayout(defaultFan())).toEqual([]);
  });

  it("saves each page as its ids joined by commas", () => {
    expect(writeFanLayout(mine)).toEqual(["search,scan,describe,quick,weight", "recipe,groups"]);
    expect(readFanLayout(writeFanLayout(mine))).toEqual(mine);
  });

  it("drops ids it doesn't know, repeats, empty pages, and anything past four pages of five", () => {
    expect(readFanLayout(["search,teleport,search", "", "a", "weight", "groups", "mine"])).toEqual([["search"], ["weight"]]);
    expect(readFanLayout(["search,scan,describe,quick,weight,recipe"])).toEqual([["search", "scan", "describe", "quick", "weight"]]);
    expect(readFanLayout(["teleport"])).toEqual(defaultFan());
  });

  it("sums up the layout for Settings", () => {
    expect(fanSummary(defaultFan())).toBe("2 pages · 10 buttons");
    expect(fanSummary([["search"]])).toBe("1 page · 1 button");
  });

  it("lists what isn't on a page, in the default order", () => {
    // The workout extras are never on the default fan, so they start here.
    expect(unusedActions(mine)).toEqual(["food", "recipes", "mine", "workout", "log-workout"]);
    expect(unusedActions(defaultFan())).toEqual(["workout", "log-workout"]);
  });
});

describe("the pages the fan shows", () => {
  it("leaves Describe out when the server can't describe meals, and drops a page left empty", () => {
    expect(fanShown([["describe"], ["search"]], false).map((page) => page.map((action) => action.id))).toEqual([["search"]]);
    expect(fanShown(mine, false)[0].map((action) => action.id)).toEqual(["search", "scan", "quick", "weight"]);
  });

  it("falls back to the default pages when nothing is left", () => {
    expect(fanShown([["describe"]], false).flat()).toHaveLength(9);
  });
});

describe("placing an action", () => {
  it("moves within a page and across pages", () => {
    expect(placeAction(mine, "weight", { section: 0, at: 0 })![0]).toEqual(["weight", "search", "scan", "describe", "quick"]);
    expect(placeAction(mine, "weight", { section: 1, at: 1 })).toEqual([["search", "scan", "describe", "quick"], ["recipe", "weight", "groups"]]);
  });

  it("won't fill a page past five, start a fifth page, or empty the fan", () => {
    expect(placeAction(mine, "mine", { section: 0, at: 2 })).toBeNull();
    expect(placeAction([["search"], ["scan"], ["quick"], ["weight"]], "mine", { section: "new", at: 0 })).toBeNull();
    expect(placeAction([["search"]], "search", { section: "out", at: 0 })).toBeNull();
  });

  it("drops a page left empty, so the rest move up", () => {
    expect(placeAction([["search"], ["scan"]], "search", { section: 1, at: 1 })).toEqual([["scan", "search"]]);
    expect(placeAction([["search"], ["scan"]], "search", { section: "out", at: 0 })).toEqual([["scan"]]);
  });

  it("adds to the last page with room, else a new page", () => {
    expect(addAction(mine, "mine")).toEqual([mine[0], ["recipe", "groups", "mine"]]);
    expect(addAction([mine[0]], "mine")).toEqual([mine[0], ["mine"]]);
  });
});

describe("moving with the keyboard", () => {
  it("steps one place, crossing into the next page", () => {
    const steps = fanSteps(mine, "weight");
    expect(steps[0][0]).toEqual(["weight", "search", "scan", "describe", "quick"]);
    expect(stepAction(mine, "weight", 1)).toEqual([["search", "scan", "describe", "quick"], ["weight", "recipe", "groups"]]);
    expect(stepAction(mine, "weight", -1)![0]).toEqual(["search", "scan", "describe", "weight", "quick"]);
  });

  it("skips a full page, and goes off the fan at the end", () => {
    expect(stepAction(mine, "recipe", -1)).toBeNull();
    expect(stepAction([["search"], ["scan"]], "scan", 1)).toEqual([["search"]]);
    expect(stepAction([["search"], ["scan"]], "scan", -1)).toEqual([["search", "scan"]]);
  });

  it("brings an action back from off the fan onto a new page, then the last page", () => {
    expect(stepAction(mine, "mine", -1)).toEqual([...mine, ["mine"]]);
    expect(stepAction([...mine, ["mine"]], "mine", -1)).toEqual([mine[0], ["recipe", "groups", "mine"]]);
  });
});

describe("dropping a dragged row", () => {
  const rows: FanRow[] = [
    { kind: "head", section: 0 }, { kind: "row", id: "search" }, { kind: "row", id: "scan" },
    { kind: "head", section: 1 }, { kind: "row", id: "recipe" },
    { kind: "head", section: "new" },
    { kind: "head", section: "out" }, { kind: "row", id: "mine" },
  ];

  it("lands in the section of the nearest heading above", () => {
    // Scan (2) dragged to just under page 2's heading.
    expect(dropSpot(rows, 2, 3)).toEqual({ section: 1, at: 0 });
    expect(dropSpot(rows, 2, 4)).toEqual({ section: 1, at: 1 });
    expect(dropSpot(rows, 7, 1)).toEqual({ section: 0, at: 0 });
    expect(dropSpot(rows, 1, 5)).toEqual({ section: "new", at: 0 });
    expect(dropSpot(rows, 1, 7)).toEqual({ section: "out", at: 1 });
    expect(dropSpot(rows, 1, 0)).toEqual({ section: 0, at: 0 });
  });
});
