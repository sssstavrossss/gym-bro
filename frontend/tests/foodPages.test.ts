import { describe, expect, it } from "vitest";
import { FOOD_PAGES, groupsNote, pageAt, pillCover, pillSpots, searchesServer } from "../src/lib/foodPages";

describe("food pages", () => {
  it("are Recent, Recipes, My foods and Groups, and only Recent searches the database", () => {
    expect(FOOD_PAGES.map((page) => page.label)).toEqual(["Recent", "Recipes", "My foods", "Groups"]);
    expect(FOOD_PAGES.filter((page) => searchesServer(page.id)).map((page) => page.id)).toEqual(["recent"]);
  });

  it("names the page under a position, wrapping past either end", () => {
    expect(pageAt(0, 4)).toBe(0);
    expect(pageAt(1.4, 4)).toBe(1);
    expect(pageAt(1.6, 4)).toBe(2);
    expect(pageAt(3.7, 4)).toBe(0);
    expect(pageAt(-0.7, 4)).toBe(3);
    expect(pageAt(2, 0)).toBe(0);
  });

  it("slides one pill between chips, and splits it across the ends while wrapping", () => {
    expect(pillSpots(0, 4)).toEqual([0]);
    expect(pillSpots(1.25, 4)).toEqual([1.25]);
    expect(pillSpots(3, 4)).toEqual([3]);
    // Groups → Recent: leaving past the right edge, entering from the left.
    expect(pillSpots(3.5, 4)).toEqual([3.5, -0.5]);
    // Recent → Groups: the mirror image.
    expect(pillSpots(-0.25, 4)).toEqual([-0.25, 3.75]);
    expect(pillSpots(9, 4)).toEqual([4, 0]);
    expect(pillSpots(Number.NaN, 4)).toEqual([0]);
  });

  it("turns a label to the pill's ink by how much of the pill is under it", () => {
    expect(pillCover([1], 1)).toBe(1);
    expect(pillCover([1.25], 1)).toBe(0.75);
    expect(pillCover([1.25], 2)).toBe(0.25);
    expect(pillCover([1.25], 3)).toBe(0);
    // Mid-wrap from Groups to Recent: a quarter of the pill left on Groups, three quarters arrived on Recent.
    expect(pillCover(pillSpots(3.75, 4), 3)).toBe(0.25);
    expect(pillCover(pillSpots(3.75, 4), 0)).toBe(0.75);
  });

  it("says when + adds a group", () => {
    expect(groupsNote("now")).toBe("+ adds every item now");
    expect(groupsNote("at 12:30")).toBe("+ adds every item at 12:30");
  });
});
