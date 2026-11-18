import { reactive } from "vue";
import { readHidden, toggleHidden, writeHidden, type PageCard } from "../lib/cardPages";

/** Hidden pages per Home card, shared by the cards and the sheet that picks them. */
export const cardPages = reactive<Record<PageCard, string[]>>({
  macros: readHidden("macros"),
  progress: readHidden("progress"),
});

export function setPageShown<T extends string>(card: PageCard, all: readonly T[], page: T, shown: boolean): void {
  const next = toggleHidden(all, cardPages[card], page, shown);
  cardPages[card] = next;
  writeHidden(card, next);
}
