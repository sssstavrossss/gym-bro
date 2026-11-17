// The look is two choices, each kept on this device: a theme (the background and cards) and an
// accent (buttons, bars, rings, charts and over marks). The colours live in main.css under
// [data-theme] and [data-accent]; index.html applies both before the first paint.

export const themeKey = "gymbro-theme";
export const accentKey = "gymbro-accent";

export const themes = [
  { id: "graphite", label: "Graphite", background: "#16181D" },
  { id: "midnight", label: "Midnight navy", background: "#121826" },
  { id: "charcoal", label: "Warm charcoal", background: "#1A1816" },
  { id: "black", label: "Pure black", background: "#000000" },
  { id: "forest", label: "Forest", background: "#151E1A" },
  { id: "plum", label: "Plum", background: "#1A151E" },
] as const;

export const accents = [
  { id: "mono", label: "Mono" },
  { id: "lagoon", label: "Lagoon" },
  { id: "sunset", label: "Sunset" },
  { id: "berry", label: "Berry" },
  { id: "meadow", label: "Meadow" },
  { id: "glacier", label: "Glacier" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export type AccentId = (typeof accents)[number]["id"];

export function isTheme(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function isAccent(value: string | null): value is AccentId {
  return accents.some((accent) => accent.id === value);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode can reject storage. The defaults apply either way.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The colour still applies for this visit.
  }
}

export function readTheme(): ThemeId {
  const stored = read(themeKey);
  return isTheme(stored) ? stored : "graphite";
}

export function readAccent(): AccentId {
  const stored = read(accentKey);
  return isAccent(stored) ? stored : "mono";
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  const background = themes.find((theme) => theme.id === id)?.background ?? themes[0].background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  write(themeKey, id);
}

export function applyAccent(id: AccentId): void {
  document.documentElement.dataset.accent = id;
  write(accentKey, id);
}
