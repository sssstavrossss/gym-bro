import { reactive } from "vue";

/**
 * Whether the server is answering. Every API call reports here (api.ts), so "offline" covers a
 * phone with no signal and a server that is down alike. `contactAt` is the last answer, which
 * the offline line shows as "updated 14:32".
 */
export const connection = reactive({
  offline: typeof navigator !== "undefined" && navigator.onLine === false,
  contactAt: 0,
});

const backListeners: (() => void)[] = [];
const chanceListeners: (() => void)[] = [];
let account = "";
let savedAt = 0;
let retryTimer = 0;

const RETRY_MS = 30_000;
const SAVE_EVERY_MS = 30_000;

function contactKey(): string {
  return `gymbro-contact:${account}`;
}

/** Reads the last contact time for this account. Call once the account is known. */
export function useAccount(id: string): void {
  account = id;
  try {
    connection.contactAt = Number(localStorage.getItem(contactKey())) || 0;
  } catch {
    connection.contactAt = 0;
  }
  savedAt = connection.contactAt;
}

/** The server answered (any status but a gateway error). */
export function noteAnswer(): void {
  const wasOffline = connection.offline;
  connection.offline = false;
  connection.contactAt = Date.now();
  window.clearTimeout(retryTimer);
  if (account && connection.contactAt - savedAt > SAVE_EVERY_MS) {
    savedAt = connection.contactAt;
    try { localStorage.setItem(contactKey(), String(savedAt)); } catch { /* private mode */ }
  }
  if (wasOffline) for (const listener of backListeners) listener();
}

/** A call could not reach the server. */
export function noteNoAnswer(): void {
  connection.offline = true;
  scheduleChance();
}

/** Runs when the server answers again after being unreachable. */
export function whenBack(listener: () => void): void {
  backListeners.push(listener);
}

/** Runs when it is worth asking the server again: the phone got a network, came to the front, or 30 seconds passed. */
export function whenChance(listener: () => void): void {
  chanceListeners.push(listener);
}

function chance(): void {
  if (!connection.offline) return;
  for (const listener of chanceListeners) listener();
  scheduleChance();
}

function scheduleChance(): void {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) chance();
    else scheduleChance();
  }, RETRY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", chance);
  window.addEventListener("offline", () => noteNoAnswer());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine !== false) chance();
  });
}
