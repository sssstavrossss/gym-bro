export const themeKey = "gymbro-theme";

export const themes = [
  { id: "graphite", label: "Graphite", background: "#16181D" },
  { id: "midnight", label: "Midnight navy", background: "#121826" },
  { id: "charcoal", label: "Warm charcoal", background: "#1A1816" },
  { id: "black", label: "Pure black", background: "#000000" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

export function isTheme(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

export function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(themeKey);
    if (isTheme(stored)) return stored;
  } catch {
    // Private mode can reject storage. Graphite is the default either way.
  }
  return "graphite";
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  const background = themes.find((theme) => theme.id === id)?.background ?? themes[0].background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  try {
    localStorage.setItem(themeKey, id);
  } catch {
    // The colour still applies for this visit.
  }
}
