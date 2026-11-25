import { parseHidden } from "./cardPages";

// Home sections, card pages and their order follow the account. Each device keeps a copy so the cards are right
// before the profile loads and while offline. A change made here is "pending" until the server has
// it, so a load that comes back first (or an offline change) doesn't lose it.

/** The id lists saved on the account: three hidden lists, the two cards' page orders, and the + fan's pages. */
export type HiddenList = "home" | "macros" | "progress" | "macrosOrder" | "progressOrder" | "fan";

export const HIDDEN_LISTS: readonly HiddenList[] = ["home", "macros", "progress", "macrosOrder", "progressOrder", "fan"];

export const SETTINGS_FIELDS = {
  home: "homeHidden",
  macros: "macrosHidden",
  progress: "progressHidden",
  macrosOrder: "macrosOrder",
  progressOrder: "progressOrder",
  fan: "fanPages",
} as const;

export function pendingKey(accountId: string): string {
  return `gymbro-display-pending:${accountId}`;
}

/**
 * What a list should be after the profile loads, and whether to send it.
 * A pending change wins. A server that has never had the list (null) takes this device's choice.
 * Otherwise the account's list replaces the device's.
 */
export function reconcileHidden(
  server: readonly string[] | null | undefined,
  local: readonly string[],
  pending: boolean,
): { use: string[]; push: boolean } {
  if (pending) return { use: [...local], push: true };
  if (server == null) return { use: [...local], push: local.length > 0 };
  return { use: [...server], push: false };
}

export function readPending(accountId: string): HiddenList[] {
  try {
    const ids = parseHidden(localStorage.getItem(pendingKey(accountId)));
    return HIDDEN_LISTS.filter((list) => ids.includes(list));
  } catch {
    return [];
  }
}

export function writePending(accountId: string, lists: readonly HiddenList[]): void {
  try {
    if (lists.length) localStorage.setItem(pendingKey(accountId), JSON.stringify(lists));
    else localStorage.removeItem(pendingKey(accountId));
  } catch {
    // Without storage the change is only sent now; a failed send waits for the next change.
  }
}
