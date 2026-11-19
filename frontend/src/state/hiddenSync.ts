import { ApiError, putSettings, type ProfileResponse } from "../api";
import { readPending, reconcileHidden, SETTINGS_FIELDS, writePending, type HiddenList } from "../lib/hiddenSync";
import { boot } from "./boot";

const sent: Record<HiddenList, number> = { home: 0, macros: 0, progress: 0 };

function setPending(list: HiddenList, on: boolean): void {
  const lists = readPending(boot.accountId).filter((item) => item !== list);
  writePending(boot.accountId, on ? [...lists, list] : lists);
}

/** Saves a list on the account. Until the server has it, it stays pending on this device. */
export function sendHidden(list: HiddenList, hidden: readonly string[]): void {
  if (!boot.accountId) return;
  setPending(list, true);
  const mine = ++sent[list];
  void putSettings({ [SETTINGS_FIELDS[list]]: [...hidden] }).then(
    () => { if (sent[list] === mine) setPending(list, false); },
    (error: unknown) => {
      // Offline or a server error: the next load sends it. A rejected list would never save, so it isn't retried.
      if (error instanceof ApiError && error.status === 400) setPending(list, false);
    },
  );
}

/** After the profile loads: the list to show, sending this device's when the server should take it. */
export function adoptHidden(list: HiddenList, saved: ProfileResponse, local: readonly string[]): string[] {
  const pending = readPending(boot.accountId).includes(list);
  const { use, push } = reconcileHidden(saved[SETTINGS_FIELDS[list]], local, pending);
  if (push) sendHidden(list, use);
  return use;
}
