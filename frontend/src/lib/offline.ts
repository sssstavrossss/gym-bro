import type { QueueSummary } from "./outbox";

/** Words for the offline line, the "You're offline" sheet and the back-online toast. */

function foods(count: number): string {
  return count === 1 ? "1 food" : `${count} foods`;
}

/** "16:00", "16:00 and 18:40", "08:00, 12:30 and 16:00", "08:00, 12:30 and 3 more". */
export function timeList(times: readonly string[]): string {
  if (times.length <= 1) return times[0] ?? "";
  if (times.length <= 3) return `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
  return `${times.slice(0, 2).join(", ")} and ${times.length - 2} more`;
}

/** "14:32" today, "Tue 14:32" this week, "12 Nov 14:32" before that. Empty when never. */
export function updatedText(at: number, now = Date.now()): string {
  if (!at) return "";
  const when = new Date(at);
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    - new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return time;
  if (days < 7) return `${when.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
  return `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

export interface SheetRow {
  icon: "cloud-off" | "alert" | "clock" | "search";
  title: string;
  detail: string;
}

/** The "You're offline" sheet, top to bottom. */
export function offlineRows(summary: QueueSummary, updated: string): SheetRow[] {
  const rows: SheetRow[] = [];
  if (summary.waiting > 0) {
    rows.push({
      icon: "cloud-off",
      title: `${foods(summary.waiting)} waiting to send`,
      detail: summary.addedAt.length
        ? `Logged at ${timeList(summary.addedAt)}. Macros already count them.`
        : "Your changes already count in the macros.",
    });
  } else {
    rows.push({ icon: "cloud-off", title: "Nothing waiting to send", detail: "Anything you log now is kept on this phone." });
  }
  if (summary.failed > 0) {
    rows.push({
      icon: "alert",
      title: `${foods(summary.failed)} couldn't send`,
      detail: "Open it on its day: Save keeps it as a quick add, or delete it.",
    });
  }
  rows.push({
    icon: "clock",
    title: updated ? `Weight and Progress are from ${updated}` : "Weight and Progress aren't on this phone yet",
    detail: summary.waiting > 0 ? "They update once your foods are sent." : "They update when you're back online.",
  });
  rows.push({
    icon: "search",
    title: "Needs a connection",
    detail: "Searching the full food list, barcode lookups, weigh-ins, recipes, groups and recalculating.",
  });
  return rows;
}

export interface SentCounts {
  sent: number;
  failed: number;
  dropped: { name: string; message: string }[];
}

/** The toast after the queue went out. Empty when there is nothing to say. */
export function sentToast(result: SentCounts): string {
  const parts: string[] = [];
  if (result.sent > 0) parts.push(`Back online. ${foods(result.sent)} sent.`);
  if (result.failed > 0) parts.push(`${foods(result.failed)} couldn't send.`);
  if (result.dropped.length === 1) {
    const [only] = result.dropped;
    parts.push(`Your change to ${only.name} wasn't saved: ${only.message}`);
  } else if (result.dropped.length > 1) {
    parts.push(`${result.dropped.length} changes weren't saved.`);
  }
  return parts.join(" ");
}

/** The note on a refused add: "Couldn't send: food not found. Save keeps it as a quick add." */
export function failedNote(reason: string | undefined): string {
  const why = (reason ?? "").trim().replace(/\.$/, "");
  const lead = why ? `Couldn't send: ${why.charAt(0).toLowerCase()}${why.slice(1)}.` : "Couldn't send.";
  return `${lead} Save keeps it as a quick add.`;
}
