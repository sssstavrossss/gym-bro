import { describe, expect, it } from "vitest";
import { base64Of, fitWithin, PHOTO_EDGE } from "../src/lib/photo";

describe("fitWithin", () => {
  it("shrinks the long edge to the photo edge and keeps the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: PHOTO_EDGE, height: 1176 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: PHOTO_EDGE });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps at least one pixel on a very thin picture, and gives nothing for an empty one", () => {
    expect(fitWithin(10000, 2)).toEqual({ width: PHOTO_EDGE, height: 1 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 600)).toEqual({ width: 0, height: 0 });
  });
});

describe("base64Of", () => {
  it("takes the part after the comma of a data URL", () => {
    expect(base64Of("data:image/jpeg;base64,/9j/4AAQ")).toBe("/9j/4AAQ");
    expect(base64Of("not a data url")).toBe("");
  });
});
