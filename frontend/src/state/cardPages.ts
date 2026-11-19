import { reactive } from "vue";
import type { ProfileResponse } from "../api";
import { readHidden, toggleHidden, writeHidden, type PageCard } from "../lib/cardPages";
import { adoptHidden, sendHidden } from "./hiddenSync";

/** Hidden pages per Home card, shared by the cards and the sheet that picks them. Saved on the account. */
export const cardPages = reactive<Record<PageCard, string[]>>({
  macros: readHidden("macros"),
  progress: readHidden("progress"),
});

export function setPageShown<T extends string>(card: PageCard, all: readonly T[], page: T, shown: boolean): void {
  const next = toggleHidden(all, cardPages[card], page, shown);
  cardPages[card] = next;
  writeHidden(card, next);
  sendHidden(card, next);
}

/** The account's choice once the profile loads; this device's copy follows it. */
export function adoptCardPages(saved: ProfileResponse): void {
  for (const card of ["macros", "progress"] as const) {
    const next = adoptHidden(card, saved, cardPages[card]);
    cardPages[card] = next;
    writeHidden(card, next);
  }
}
