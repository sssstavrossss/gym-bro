import { reactive } from "vue";
import type { ProfileResponse } from "../api";
import { movePage, ORDER_KEYS, readHidden, readIds, toggleHidden, writeHidden, writeIds, type PageCard } from "../lib/cardPages";
import { adoptHidden, sendHidden } from "./hiddenSync";

/** Hidden pages per Home card, shared by the cards and the sheet that picks them. Saved on the account. */
export const cardPages = reactive<Record<PageCard, string[]>>({
  macros: readHidden("macros"),
  progress: readHidden("progress"),
});

/** Each card's page order (empty is the default). Saved on the account, like the hidden pages. */
export const pageOrder = reactive<Record<PageCard, string[]>>({
  macros: readIds(ORDER_KEYS.macros),
  progress: readIds(ORDER_KEYS.progress),
});

const ORDER_LISTS = { macros: "macrosOrder", progress: "progressOrder" } as const;

export function setPageShown<T extends string>(card: PageCard, all: readonly T[], page: T, shown: boolean): void {
  const next = toggleHidden(all, cardPages[card], page, shown);
  cardPages[card] = next;
  writeHidden(card, next);
  sendHidden(card, next);
}

/** Moves a page to a place in the card's full list (hidden pages count). */
export function setPagePlace<T extends string>(card: PageCard, all: readonly T[], page: T, to: number): void {
  saveOrder(card, movePage(all, pageOrder[card], page, to));
}

export function resetPageOrder(card: PageCard): void {
  saveOrder(card, []);
}

function saveOrder(card: PageCard, next: string[]): void {
  if (next.join() === pageOrder[card].join()) return;
  pageOrder[card] = next;
  writeIds(ORDER_KEYS[card], next);
  sendHidden(ORDER_LISTS[card], next);
}

/** The account's choice once the profile loads; this device's copy follows it. */
export function adoptCardPages(saved: ProfileResponse): void {
  for (const card of ["macros", "progress"] as const) {
    const next = adoptHidden(card, saved, cardPages[card]);
    cardPages[card] = next;
    writeHidden(card, next);
    const order = adoptHidden(ORDER_LISTS[card], saved, pageOrder[card]);
    pageOrder[card] = order;
    writeIds(ORDER_KEYS[card], order);
  }
}
