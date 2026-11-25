import { NUTRIENT_PANELS } from "./nutrients";
import { goalKind, PAGE_TITLES, PROGRESS_PAGES, type GoalKind } from "./progressCard";

// Home's swipe cards (Macros and Progress) can hide pages. The first page of each card is
// always shown. The choice is kept on this device, like the chart range and the theme.

export type PageCard = "macros" | "progress";

export const HIDDEN_KEYS: Record<PageCard, string> = {
  macros: "gymbro-home-macros-hidden",
  progress: "gymbro-home-progress-hidden",
};

/** Reads a stored list of hidden page ids. Anything that isn't a list of strings is "none hidden". */
export function parseHidden(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function readHidden(card: PageCard): string[] {
  try {
    return parseHidden(localStorage.getItem(HIDDEN_KEYS[card]));
  } catch {
    // Private mode can reject storage. Every page shows.
    return [];
  }
}

export function writeHidden(card: PageCard, hidden: readonly string[]): void {
  try {
    if (hidden.length) localStorage.setItem(HIDDEN_KEYS[card], JSON.stringify(hidden));
    else localStorage.removeItem(HIDDEN_KEYS[card]);
  } catch {
    // The choice still applies for this visit.
  }
}

/** The pages to swipe through: all of them in order, less the hidden ones. The first never hides. */
export function visiblePages<T extends string>(all: readonly T[], hidden: readonly string[]): T[] {
  return all.filter((page, index) => index === 0 || !hidden.includes(page));
}

/** The hidden list after a switch. Ids stay in the card's order and the first page can't be hidden. */
export function toggleHidden<T extends string>(all: readonly T[], hidden: readonly string[], page: T, shown: boolean): T[] {
  return all.filter((item, index) => index > 0 && (item === page ? !shown : hidden.includes(item)));
}

/** Where the card lands when its pages change: the same page if it's still shown, else the first. */
export function followPage<T extends string>(current: T | undefined, next: readonly T[]): number {
  const index = current == null ? -1 : next.indexOf(current);
  return index < 0 ? 0 : index;
}

/** The Macros card's pages: Macros, then each nutrient panel. */
export const MACRO_PAGES = ["macros", ...NUTRIENT_PANELS.map((panel) => panel.id)] as const;

export interface PageRow { id: string; title: string; caption: string }

const KIND_CAPTIONS: Record<GoalKind, string> = { target: "Target ±10%", minimum: "Minimum", limit: "Limit" };
const ALWAYS = "Always shown";

/** The sheet's rows for a card: each page's name and a line about it. */
export function pageRows(card: PageCard): PageRow[] {
  if (card === "progress") {
    return PROGRESS_PAGES.map((page, index) => ({
      id: page,
      title: PAGE_TITLES[page],
      caption: index === 0 ? ALWAYS : page === "burn" ? "Daily burn and BMR" : KIND_CAPTIONS[goalKind(page)],
    }));
  }
  return [
    { id: "macros", title: "Macros", caption: ALWAYS },
    ...NUTRIENT_PANELS.map((panel) => ({ id: panel.id, title: panel.title, caption: panelCaption(panel.id, panel.keys.length) })),
  ];
}

function panelCaption(id: string, count: number): string {
  if (id === "fats") return "Saturated, mono, poly, omega-3 and more";
  if (id === "carbs") return "Sugars, added sugars, starch, fibre, sodium";
  return `${count} ${id}`;
}

export function pageIds(card: PageCard): readonly string[] {
  return card === "progress" ? PROGRESS_PAGES : MACRO_PAGES;
}
