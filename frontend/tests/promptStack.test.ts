import { describe, expect, it } from "vitest";
import { frontFor, nextFront, stackPlaces, stackThrow } from "../src/lib/promptStack";

const order = ["fresh", "recalc", "weigh", "goal"];
const set = (...keys: string[]) => new Set(keys);

describe("stackPlaces", () => {
  it("is empty when nothing shows", () => {
    expect(stackPlaces(order, set(), null)).toEqual({ front: null, back: null, rest: [] });
  });

  it("puts the first shown card in front and the next behind it", () => {
    expect(stackPlaces(order, set("weigh", "recalc"), null)).toEqual({ front: "recalc", back: "weigh", rest: [] });
  });

  it("a single card has nothing behind it", () => {
    expect(stackPlaces(order, set("goal"), null)).toEqual({ front: "goal", back: null, rest: [] });
  });

  it("keeps the chosen card in front and wraps the rest behind it in order", () => {
    expect(stackPlaces(order, set("recalc", "weigh", "goal"), "weigh")).toEqual({ front: "weigh", back: "goal", rest: ["recalc"] });
  });

  it("brings the next card forward when the front one goes, wrapping to the first", () => {
    expect(stackPlaces(order, set("recalc", "weigh"), "goal")).toEqual({ front: "recalc", back: "weigh", rest: [] });
    expect(stackPlaces(order, set("recalc", "goal"), "weigh")).toEqual({ front: "goal", back: "recalc", rest: [] });
  });
});

describe("frontFor", () => {
  it("is null when nothing shows", () => {
    expect(frontFor(order, set(), "recalc")).toBeNull();
  });

  it("ignores a key that isn't in the order", () => {
    expect(frontFor(order, set("weigh"), "nope")).toBe("weigh");
  });
});

describe("nextFront", () => {
  it("goes to the next shown card and wraps from the last to the first", () => {
    const shown = set("recalc", "weigh", "goal");
    expect(nextFront(order, shown, "recalc")).toBe("weigh");
    expect(nextFront(order, shown, "weigh")).toBe("goal");
    expect(nextFront(order, shown, "goal")).toBe("recalc");
  });

  it("stays put with one card", () => {
    expect(nextFront(order, set("weigh"), "weigh")).toBe("weigh");
  });

  it("is null when nothing shows", () => {
    expect(nextFront(order, set(), null)).toBeNull();
  });
});

describe("stackThrow", () => {
  it("throws a long sideways drag to that side", () => {
    expect(stackThrow(-90, 4, 400)).toBe(-1);
    expect(stackThrow(90, -4, 400)).toBe(1);
  });

  it("throws a quick flick", () => {
    expect(stackThrow(-30, 0, 40)).toBe(-1);
  });

  it("lets go of a short or slow drag", () => {
    expect(stackThrow(-60, 0, 400)).toBe(0);
    expect(stackThrow(20, 0, 10)).toBe(0);
  });

  it("never throws an up or down drag, which scrolls the page", () => {
    expect(stackThrow(30, 120, 100)).toBe(0);
  });
});
