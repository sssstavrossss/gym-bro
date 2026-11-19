import { boot } from "../state/boot";
import { offlineStore } from "./store";

/** The server's last answer to a GET, per account, so a screen can show it when the server can't be reached. */
function key(account: string, path: string): string {
  return `${account}:${path}`;
}

export async function rememberAnswer(path: string, body: unknown): Promise<void> {
  if (!boot.accountId) return;
  await offlineStore.put(key(boot.accountId, path), { at: Date.now(), body });
}

export async function recallAnswer<T>(path: string): Promise<T | null> {
  if (!boot.accountId) return null;
  return (await offlineStore.get<T>(key(boot.accountId, path)))?.body ?? null;
}

/** Sign-out: nothing of this account's data stays readable on the phone. */
export async function forgetAnswers(account: string): Promise<void> {
  if (account) await offlineStore.clear(`${account}:`);
}
