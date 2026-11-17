// Vitest runs in Node. The app tsconfig only loads DOM types.
// @ts-expect-error node builtin is available when the tests run
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/main.css", import.meta.url), "utf8");
const tokenRe = /--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g;
const tokensOf = (block: string) => Object.fromEntries([...block.matchAll(tokenRe)].map((match) => [match[1], match[2].toLowerCase()]));
/** Each theme's own block of tokens, so every theme is checked, not only the last one in the file. */
const blocks = (attribute: string): Record<string, Record<string, string>> =>
  Object.fromEntries([...css.matchAll(new RegExp(`\\[data-${attribute}="(\\w+)"\\]\\s*\\{([^}]*)\\}`, "g"))].map((match) => [match[1], tokensOf(match[2])]));
const themes = blocks("theme");
/** Mono only labels its settings swatch. The colours it leaves in place are checked with the themes. */
const { mono: _mono, ...accents } = blocks("accent");
const tokens = themes.black;

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

/** color-mix(in srgb, a p%, b): each channel mixed as stored, as the browser does. */
function mix(a: string, b: string, share: number): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((value, index) => Math.round((value * share + y[index] * (1 - share)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function ratio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const backgrounds = (theme: Record<string, string>) => ({
  "color-bg": theme["color-bg"],
  "color-surface": theme["color-surface"],
  "color-surface-2": theme["color-surface-2"],
});

describe("contrast tokens", () => {
  it("uses the prototype secondary, tertiary, and strong border", () => {
    expect(tokens["text-secondary"]).toBe("#b3b3ba");
    expect(tokens["text-tertiary"]).toBe("#9c9ca4");
    expect(tokens["color-border-strong"]).toBe("#737379");
  });

  it("finds every theme", () => {
    expect(Object.keys(themes)).toEqual(["graphite", "midnight", "charcoal", "black", "forest", "plum"]);
  });

  it.each(Object.keys(themes))("%s keeps text at 4.5:1, on the raised box too", (name) => {
    const theme = themes[name];
    for (const text of ["text-primary", "text-secondary", "text-tertiary"]) {
      for (const [backgroundName, background] of Object.entries(backgrounds(theme))) {
        expect(ratio(theme[text], background), `${text} on ${backgroundName}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("finds every accent", () => {
    expect(Object.keys(accents)).toEqual(["lagoon", "sunset", "berry", "meadow", "glacier"]);
  });

  // Each accent on each theme: dark text on the main colour (buttons, on-target days) and on the
  // calendar's close days; over tags as text on every card; main and fill as marks at 3:1.
  for (const [accentName, accent] of Object.entries(accents)) {
    it.each(Object.keys(themes))(`${accentName} reads on %s`, (themeName) => {
      const theme = themes[themeName];
      const onAction = theme["color-on-action"];
      expect(ratio(onAction, accent["accent-main"]), "text on main").toBeGreaterThanOrEqual(4.5);
      expect(ratio(onAction, mix(accent["accent-fill"], theme["color-bg"], 0.7)), "text on a close day").toBeGreaterThanOrEqual(4.5);
      for (const [backgroundName, background] of Object.entries(backgrounds(theme))) {
        expect(ratio(accent["accent-over"], background), `over text on ${backgroundName}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(accent["accent-main"], background), `main on ${backgroundName}`).toBeGreaterThanOrEqual(3);
        expect(ratio(accent["accent-fill"], background), `fill on ${backgroundName}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("keeps the strong border at 3:1", () => {
    expect(ratio(tokens["color-border-strong"], tokens["color-surface"])).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens["color-border-strong"], tokens["color-surface-2"])).toBeGreaterThanOrEqual(3);
  });
});
