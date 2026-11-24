// Add food's "added" card: the foods added since the sheet opened, as rows like Home's.
import { int } from "./format";

/** What the card needs of a log entry. */
export interface SessionEntry {
  id: string;
  idempotencyKey: string;
  kcal: number;
  queued?: "waiting" | "failed";
}

/**
 * The card's rows, newest first. `added` holds each entry as it was added. `day` is that day's entries as the app
 * has them now, or null when the day isn't loaded: then the rows are the entries as added. Otherwise each row is
 * the day's current copy (an edit shows, a delete hides it, an undo brings it back), found by its idempotency key
 * so an add that was queued offline keeps its row when it gets its server id.
 */
export function sessionRows<T extends SessionEntry>(added: readonly T[], day: readonly T[] | null): T[] {
  const newest = [...added].reverse();
  if (!day) return newest;
  const byKey = new Map(day.map((entry) => [entry.idempotencyKey, entry]));
  const byId = new Map(day.map((entry) => [entry.id, entry]));
  const rows: T[] = [];
  for (const entry of newest) {
    const now = byKey.get(entry.idempotencyKey) ?? byId.get(entry.id);
    if (now && !rows.includes(now)) rows.push(now);
  }
  return rows;
}

/** kcal of these rows. A refused add counts for nothing, as on the day. */
export function sessionKcal(rows: readonly SessionEntry[]): number {
  return rows.reduce((sum, row) => sum + (row.queued === "failed" ? 0 : row.kcal), 0);
}

/**
 * The card's two lines. Normally "2 added · 237 kcal" over the day ("Today · 975 kcal"). While selecting, the
 * title counts the selection and the second line keeps the added count, so nothing else on the card changes.
 */
export function sessionLines(rows: readonly SessionEntry[], picked: readonly string[] | null, day: string, dayKcal: number): { title: string; sub: string } {
  const added = `${rows.length} added · ${int(sessionKcal(rows))} kcal`;
  if (picked == null) return { title: added, sub: `${day} · ${int(dayKcal)} kcal` };
  const chosen = rows.filter((row) => picked.includes(row.id));
  return { title: `${chosen.length} selected · ${int(sessionKcal(chosen))} kcal`, sub: added };
}
