// Vitest runs in Node. The app tsconfig only loads DOM types.
// @ts-expect-error node builtin is available when the tests run
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/main.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((match) => [match[1], match[2].toLowerCase()]));

function channels(hex: string): number[] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((char) => char + char).join("") : value;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(linear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function ratio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const backgrounds = {
  "color-bg": tokens["color-bg"],
  "color-surface": tokens["color-surface"],
  "color-surface-2": tokens["color-surface-2"],
  "#202023": "#202023",
  "#303036": "#303036",
};

describe("contrast tokens", () => {
  it("uses the prototype secondary, tertiary, and strong border", () => {
    expect(tokens["text-secondary"]).toBe("#b3b3ba");
    expect(tokens["text-tertiary"]).toBe("#9c9ca4");
    expect(tokens["color-border-strong"]).toBe("#737379");
  });

  it("keeps text at 4.5:1 and the strong border at 3:1", () => {
    for (const name of ["text-primary", "text-secondary", "text-tertiary"]) {
      for (const [backgroundName, background] of Object.entries(backgrounds)) {
        expect(ratio(tokens[name], background), `${name} on ${backgroundName}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(ratio(tokens["color-border-strong"], tokens["color-surface"])).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens["color-border-strong"], tokens["color-surface-2"])).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens["text-secondary"], tokens["color-surface"])).toBeGreaterThanOrEqual(3);
  });
});
