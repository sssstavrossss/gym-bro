import { FAN_ACTIONS, FAN_PER_PAGE, fanActions, fanPages, type FanAction, type FanActionId } from "./fan";

/**
 * The + fan's pages as the person arranges them: up to four pages of one to five actions. Saved on
 * the account as one string per page, the ids joined by commas; an empty list is the default layout.
 * Actions not on a page are "not in the fan". A page left empty goes, and the rest move up.
 */

export const FAN_MAX_PAGES = 4;
export const FAN_PAGES_KEY = "gymbro-fan-pages";

export type FanLayout = FanActionId[][];

const IDS: readonly FanActionId[] = FAN_ACTIONS.map((action) => action.id);
/** The default fan leaves out the extras (Start workout, Log workout). */
const DEFAULT_IDS: readonly FanActionId[] = FAN_ACTIONS.filter((action) => !action.extra).map((action) => action.id);
const BY_ID = new Map(FAN_ACTIONS.map((action) => [action.id, action]));

/** Every action but the extras, five to a page, in FAN_ACTIONS order. */
export function defaultFan(): FanLayout {
  return fanPages(DEFAULT_IDS);
}

export function fanAction(id: FanActionId): FanAction {
  return BY_ID.get(id)!;
}

function isFanAction(id: string): id is FanActionId {
  return BY_ID.has(id as FanActionId);
}

const key = (pages: readonly (readonly string[])[]) => pages.map((page) => page.join(",")).join("|");

/** A saved layout as pages. Ids this version doesn't know and repeats drop out; nothing left is the default. */
export function readFanLayout(saved: readonly string[]): FanLayout {
  const seen = new Set<string>();
  const pages = saved
    .slice(0, FAN_MAX_PAGES)
    .map((page) => page.split(",").filter((id): id is FanActionId => isFanAction(id) && !seen.has(id) && Boolean(seen.add(id))).slice(0, FAN_PER_PAGE))
    .filter((page) => page.length);
  return pages.length ? pages : defaultFan();
}

/** What to save: the pages, or nothing when they are the default. */
export function writeFanLayout(pages: FanLayout): string[] {
  return key(pages) === key(defaultFan()) ? [] : pages.map((page) => page.join(","));
}

export function sameFan(a: FanLayout, b: FanLayout): boolean {
  return key(a) === key(b);
}

/**
 * The pages the fan shows. Describe only when the server can describe meals, so its page has one
 * button fewer; a page left with none goes. If nothing at all is left, the default pages show.
 */
export function fanShown(pages: FanLayout, describeOn: boolean): FanAction[][] {
  const shown = pages
    .map((page) => page.filter((id) => describeOn || id !== "describe").map(fanAction))
    .filter((page) => page.length);
  return shown.length ? shown : fanPages(fanActions(describeOn));
}

/** Settings' line for the + button: "2 pages · 10 buttons". */
export function fanSummary(pages: FanLayout): string {
  const count = pages.flat().length;
  return `${pages.length} ${pages.length === 1 ? "page" : "pages"} · ${count} ${count === 1 ? "button" : "buttons"}`;
}

/** Actions on no page, in FAN_ACTIONS order. A new action in a later version starts here. */
export function unusedActions(pages: FanLayout): FanActionId[] {
  const used = new Set(pages.flat());
  return IDS.filter((id) => !used.has(id));
}

/** A place for an action: a spot on a page, a new page at the end, or off the fan. */
export type FanSection = number | "new" | "out";

export interface FanSpot {
  section: FanSection;
  at: number;
}

/**
 * The layout with `id` moved to `spot`, or null when it can't go there: a full page, a fifth page,
 * or taking the fan's last action off. A page left empty goes.
 */
export function placeAction(pages: FanLayout, id: FanActionId, spot: FanSpot): FanLayout | null {
  const next = pages.map((page) => page.filter((item) => item !== id));
  if (spot.section === "new") {
    if (next.filter((page) => page.length).length >= FAN_MAX_PAGES) return null;
    next.push([id]);
  } else if (spot.section !== "out") {
    const page = next[spot.section];
    if (!page || page.length >= FAN_PER_PAGE) return null;
    page.splice(Math.max(0, Math.min(spot.at, page.length)), 0, id);
  }
  const kept = next.filter((page) => page.length);
  return kept.length ? kept : null;
}

/** + on an action off the fan: onto the last page if it has room, else a new page, else the first page with room. */
export function addAction(pages: FanLayout, id: FanActionId): FanLayout | null {
  const last = pages.length - 1;
  if (pages[last] && pages[last].length < FAN_PER_PAGE) return placeAction(pages, id, { section: last, at: pages[last].length });
  return placeAction(pages, id, { section: "new", at: 0 })
    ?? placeAction(pages, id, { section: Math.max(0, pages.findIndex((page) => page.length < FAN_PER_PAGE)), at: FAN_PER_PAGE });
}

/** Every layout `id` can move to, in list order, each once: the keyboard steps through these. */
export function fanSteps(pages: FanLayout, id: FanActionId): FanLayout[] {
  const spots: FanSpot[] = [];
  pages.forEach((page, section) => {
    const count = page.filter((item) => item !== id).length;
    for (let at = 0; at <= count; at += 1) spots.push({ section, at });
  });
  spots.push({ section: "new", at: 0 }, { section: "out", at: 0 });
  const seen = new Set<string>();
  const steps: FanLayout[] = [];
  for (const spot of spots) {
    const next = placeAction(pages, id, spot);
    if (!next || seen.has(key(next))) continue;
    seen.add(key(next));
    steps.push(next);
  }
  return steps;
}

/** ↑ (-1) or ↓ (1) on an action's grip: the next place it can go that way, or null at the end of the list. */
export function stepAction(pages: FanLayout, id: FanActionId, step: 1 | -1): FanLayout | null {
  const steps = fanSteps(pages, id);
  const here = steps.findIndex((layout) => sameFan(layout, pages));
  return steps[here + step] ?? null;
}

/** One line in the editor's list: a section heading (a page, the new page slot, "Not in the fan") or an action. */
export type FanRow = { kind: "head"; section: FanSection } | { kind: "row"; id: FanActionId };

/**
 * Where a dragged row lands. `to` is its place among the other lines (see `dropIndex`); the section is
 * the nearest heading above that place, and the spot counts the actions between them.
 */
export function dropSpot(rows: readonly FanRow[], from: number, to: number): FanSpot {
  const others = rows.filter((_, index) => index !== from);
  let at = 0;
  for (let index = to - 1; index >= 0; index -= 1) {
    const row = others[index];
    if (row.kind === "head") return { section: row.section, at };
    at += 1;
  }
  return { section: 0, at: 0 };
}
