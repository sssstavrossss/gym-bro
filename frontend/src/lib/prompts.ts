import { reactive } from "vue";

export const promptState = reactive({ goal: 0 });

function goalKey(accountId: string, latestDate: string, goalKg: string): string {
  return `gymbro-goal-keep:${accountId}:${latestDate}:${goalKg}`;
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
