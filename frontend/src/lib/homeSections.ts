import { parseHidden } from "./cardPages";
import type { ScreenLayout } from "./layout";

// Home's cards under the week strip. The week always shows; every other card can be switched off
// in Settings → Home sections. A new card joins HOME_SECTIONS and shows until it is switched off,
// because only the hidden ids are stored. The choice is kept on this device, like the theme.

export type HomeSection = "suggestions" | "macros" | "foods" | "progress";

export interface SectionRow { id: HomeSection; title: string; caption: string }

export const HOME_SECTIONS: readonly SectionRow[] = [
  { id: "suggestions", title: "Suggestions", caption: "Recalculate, fresh start, goal reached" },
  { id: "macros", title: "Macros", caption: "The swipe card with the day's targets" },
  { id: "foods", title: "Foods today", caption: "The day's foods and Add food" },
  { id: "progress", title: "Progress", caption: "Weight and intake charts" },
];

/** The locked first row of the picker. It isn't stored and can't be hidden. */
export const WEEK_ROW = { title: "Week", caption: "Always shown" } as const;

export const HOME_HIDDEN_KEY = "gymbro-home-hidden";

/** Wider layouts show the weight card (and This week) where the phone shows Progress. */
export function sectionRows(layout: ScreenLayout): SectionRow[] {
  if (layout === "phone") return [...HOME_SECTIONS];
  const progress = layout === "tablet" ? "The weight card" : "The weight card and This week";
  return HOME_SECTIONS.map((row) => (row.id === "progress" ? { ...row, caption: progress } : row));
}

export function readHiddenSections(): HomeSection[] {
  try {
    return knownOnly(parseHidden(localStorage.getItem(HOME_HIDDEN_KEY)));
  } catch {
    // Private mode can reject storage. Every card shows.
    return [];
  }
}

export function writeHiddenSections(hidden: readonly HomeSection[]): void {
  try {
    if (hidden.length) localStorage.setItem(HOME_HIDDEN_KEY, JSON.stringify(hidden));
    else localStorage.removeItem(HOME_HIDDEN_KEY);
  } catch {
    // The choice still applies for this visit.
  }
}

/** The hidden list after a switch, in Home's order. Ids that are no longer cards drop out. */
export function toggleSection(hidden: readonly string[], id: HomeSection, shown: boolean): HomeSection[] {
  return HOME_SECTIONS.map((row) => row.id).filter((item) => (item === id ? !shown : hidden.includes(item)));
}

/** Settings' row: "Week, Macros, Progress" and "3 of 5". The week counts, since it's in the list. */
export function sectionsSummary(hidden: readonly string[]): { names: string; count: string } {
  const shown = HOME_SECTIONS.filter((row) => !hidden.includes(row.id));
  return {
    names: [WEEK_ROW.title, ...shown.map((row) => row.title)].join(", "),
    count: `${shown.length + 1} of ${HOME_SECTIONS.length + 1}`,
  };
}

function knownOnly(ids: readonly string[]): HomeSection[] {
  return HOME_SECTIONS.map((row) => row.id).filter((id) => ids.includes(id));
}
