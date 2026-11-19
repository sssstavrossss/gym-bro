import type { TargetsResponse } from "../api";
import { log, viewed, type LogEntry } from "./log";
import { profile } from "./profile";

// The day a food or recipe is being logged to, as the amount screens' macros card shows it.

/** That day's entries: the day open in the log, or today. Another day that isn't loaded has none. */
export function entriesOn(date: string, today: string): LogEntry[] {
  if (viewed.date === date) return viewed.entries;
  if (date === today) return log.entries;
  return [];
}

/** That day's targets for the bars. Null when it has none, or it isn't today and isn't loaded. */
export function targetOn(date: string, today: string): TargetsResponse | null {
  return (viewed.date === date ? viewed.target : null) ?? (date === today ? profile.targets : null);
}

/** The card's title: "Today after adding", "That day after saving", or "Macros" without targets. */
export function afterTitle(date: string, today: string, verb: "adding" | "saving", hasGoal: boolean): string {
  if (!hasGoal) return "Macros";
  return `${date === today ? "Today" : "That day"} after ${verb}`;
}
