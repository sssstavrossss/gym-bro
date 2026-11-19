import { ping } from "../api";
import { useAccount, whenBack, whenChance } from "./connection";
import { catchUp, sendQueue } from "./log";
import { hasSendable, useOutboxAccount } from "./outbox";
import { profile, retryLoad } from "./profile";

let started = false;

/**
 * Offline catch-up for the signed-in account: its queue and last contact time load, and once
 * the server answers again the queue goes out and the screens refresh.
 */
export function startSync(accountId: string): void {
  useAccount(accountId);
  useOutboxAccount(accountId);
  if (started) return;
  started = true;
  whenBack(() => {
    // Opened offline with no profile kept: load it now that the server answers.
    if (profile.offline) void retryLoad();
    void catchUp();
  });
  whenChance(() => {
    void (hasSendable() ? sendQueue() : ping());
  });
}
