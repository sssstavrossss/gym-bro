import type { InboxItem } from "../api";

/** Notification types the app shows on Home while open (the Profile card points there instead of repeating them). */
export const SHOWN_ON_HOME = ["recalculate"];

export interface RecentNote {
  id: number;
  label: string;
  /** The full text, kept only while the notification is open. Read ones collapse to their label. */
  body: string;
  /** "today": open and shown on Home. "new": open, shown only here. "done": read, dismissed, or acted on. */
  state: "today" | "new" | "done";
  date: string;
}

/** "16 Nov" in the person's zone. The weekly reminder is stamped at local midnight, so UTC would say the 15th. */
export function noteDate(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
  }
}

/** The newest few, newest first. Older ones stay on the server but are not listed. */
export function recentNotes(items: readonly InboxItem[], zone: string, limit = 10): RecentNote[] {
  return [...items]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      label: item.type === "recalculate" ? "Recalculate this week" : item.title,
      body: item.readAt ? "" : item.body,
      state: item.readAt ? "done" : SHOWN_ON_HOME.includes(item.type) ? "today" : "new",
      date: noteDate(item.createdAt, zone),
    }));
}
