import { reactive } from "vue";

export const promptState = reactive({ fresh: 0, goal: 0 });

function freshKey(accountId: string, date: string): string {
  return `gymbro-fresh-no:${accountId}:${date}`;
}

function goalKey(accountId: string, latestDate: string, goalKg: string): string {
  return `gymbro-goal-keep:${accountId}:${latestDate}:${goalKg}`;
}

export function freshDismissed(accountId: string, date: string): boolean {
  try {
    return sessionStorage.getItem(freshKey(accountId, date)) === "1";
  } catch {
    return false;
  }
}

/** Not now writes nothing on the server. The card stays hidden until the next fresh start. */
export function dismissFresh(accountId: string, date: string): void {
  try {
    sessionStorage.setItem(freshKey(accountId, date), "1");
  } catch {
    // Private mode can block storage. The card will ask again on the next load.
  }
  promptState.fresh += 1;
}

export function goalDismissed(accountId: string, latestDate: string, goalKg: string): boolean {
  try {
    return sessionStorage.getItem(goalKey(accountId, latestDate, goalKg)) === "1";
  } catch {
    return false;
  }
}

export function dismissGoal(accountId: string, latestDate: string, goalKg: string): void {
  try {
    sessionStorage.setItem(goalKey(accountId, latestDate, goalKg), "1");
  } catch {
    // Same as a fresh-start dismissal.
  }
  promptState.goal += 1;
}
