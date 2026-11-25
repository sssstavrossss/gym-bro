import { NUTRIENT_PANELS } from "./nutrients";
import { goalKind, PAGE_TITLES, PROGRESS_PAGES, type GoalKind } from "./progressCard";

// Home's swipe cards (Macros and Progress) can hide and reorder pages. Each card's first page in
// the default order (Macros, Weight) can move but is always shown. Both choices follow the account,
// with a copy on each device (see hiddenSync).

export type PageCard = "macros" | "progress";

export const HIDDEN_KEYS: Record<PageCard, string> = {
  macros: "gymbro-home-macros-hidden",
  progress: "gymbro-home-progress-hidden",
};

export const ORDER_KEYS: Record<PageCard, string> = {
  macros: "gymbro-home-macros-order",
  progress: "gymbro-home-progress-order",
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

/** Reads a stored id list (hidden pages, or a page order). Private mode can reject storage: then it's empty. */
export function readIds(key: string): string[] {
  try {
    return parseHidden(localStorage.getItem(key));
  } catch {
    return [];
  }
}

export function writeIds(key: string, ids: readonly string[]): void {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // The choice still applies for this visit.
  }
}

export const readHidden = (card: PageCard) => readIds(HIDDEN_KEYS[card]);
export const writeHidden = (card: PageCard, hidden: readonly string[]) => writeIds(HIDDEN_KEYS[card], hidden);

/**
 * The card's pages in the saved order. Unknown ids drop out. A page the order doesn't name (one
 * added since it was saved) goes in right after the page before it in the default order.
 * An empty order is the default.
 */
export function orderPages<T extends string>(all: readonly T[], order: readonly string[]): T[] {
  const result = order.filter((id, index): id is T => (all as readonly string[]).includes(id) && order.indexOf(id) === index);
  all.forEach((page, index) => {
    if (result.includes(page)) return;
    const after = index === 0 ? -1 : result.indexOf(all[index - 1]);
    result.splice(after + 1, 0, page);
  });
  return result;
}

/**
 * The order to save after moving a page to a place in the full list (hidden pages included).
 * Back to the default order saves as empty, so later pages keep their default places.
 */
export function movePage<T extends string>(all: readonly T[], order: readonly string[], page: T, to: number): T[] {
  const next = orderPages(all, order).filter((item) => item !== page);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, page);
  return isDefaultOrder(all, next) ? [] : next;
}

export function isDefaultOrder(all: readonly string[], order: readonly string[]): boolean {
  const ordered = orderPages(all, order);
  return ordered.every((page, index) => page === all[index]);
}

/**
 * The pages to swipe through: all of them in the saved order, less the hidden ones.
 * The card's first default page (Macros, Weight) never hides, wherever it is.
 */
export function visiblePages<T extends string>(all: readonly T[], hidden: readonly string[], order: readonly string[] = []): T[] {
  return orderPages(all, order).filter((page) => page === all[0] || !hidden.includes(page));
}

/** The hidden list after a switch. Ids stay in the card's order and the first page can't be hidden. */
export function toggleHidden<T extends string>(all: readonly T[], hidden: readonly string[], page: T, shown: boolean): T[] {
  return all.filter((item, index) => index > 0 && (item === page ? !shown : hidden.includes(item)));
}

/** Where the card lands when its pages change or move: the same page if it's still shown, else the first. */
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
