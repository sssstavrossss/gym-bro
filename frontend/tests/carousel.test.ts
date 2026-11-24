import { describe, expect, it } from "vitest";
import { shortTurn, wrapTurn } from "../src/lib/carousel";

const slow = [{ t: 0, x: 200 }, { t: 400, x: 170 }];

describe("wrapTurn", () => {
  it("a leftward pull on the last card goes to the first", () => {
    expect(wrapTurn("last", -40, 4, slow)).toBe(1);
  });
  it("a rightward pull on the first card goes to the last", () => {
    expect(wrapTurn("first", 40, -3, [{ t: 0, x: 100 }, { t: 400, x: 140 }])).toBe(-1);
  });
  it("pulling the wrong way, a short slow drag, or a vertical drag stays", () => {
    expect(wrapTurn("last", 60, 0, slow)).toBe(0);
    expect(wrapTurn("first", -60, 0, slow)).toBe(0);
    expect(wrapTurn("last", -20, 0, slow)).toBe(0);
    expect(wrapTurn("last", -40, 80, slow)).toBe(0);
  });
  it("a quick short flick wraps", () => {
    expect(wrapTurn("last", -18, 2, [{ t: 0, x: 200 }, { t: 40, x: 182 }])).toBe(1);
    expect(wrapTurn("last", -10, 2, [{ t: 0, x: 200 }, { t: 20, x: 190 }])).toBe(0);
  });
});

describe("shortTurn", () => {
  it("goes the short way round, wrapping when that is shorter", () => {
    expect(shortTurn(0, 1, 4)).toBe(1);
    expect(shortTurn(0, 3, 4)).toBe(-1);
    expect(shortTurn(3, 0, 4)).toBe(1);
    expect(shortTurn(0, 2, 4)).toBe(2);
    expect(shortTurn(2, 2, 4)).toBe(0);
    expect(shortTurn(0, 1, 0)).toBe(0);
  });
});
