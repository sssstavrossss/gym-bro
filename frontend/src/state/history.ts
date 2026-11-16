import { reactive } from "vue";
import { getTargetHistory, markTargetsSeen, type TargetHistoryRow } from "../api";
import { inbox } from "./inbox";

/**
 * Target history for Profile. `fresh` holds what was new when Profile opened: the strip on Targets and the
 * row dots keep showing for that visit, while the server already counts them as seen for the next one.
 */
export const history = reactive({
  rows: [] as TargetHistoryRow[],
  fresh: [] as number[],
  loaded: false,
});

export async function loadHistory(markSeen = false): Promise<void> {
  try {
    const rows = (await getTargetHistory()).rows;
    history.rows = rows;
    const fresh = rows.flatMap((row, index) => (row.isNew ? [index] : []));
    if (markSeen) {
      history.fresh = fresh;
      if (fresh.length || inbox.targets) {
        inbox.targets = false;
        void markTargetsSeen().catch(() => undefined);
      }
    } else {
      // A reload follows a change the person made (Recalculate), which supersedes the Monday update.
      history.fresh = [];
    }
  } catch {
    history.rows = [];
    history.fresh = [];
  }
  history.loaded = true;
}

/** The newest automatic change and the target before it, for the strip on Targets. */
export function latestChange(): { index: number; row: TargetHistoryRow; before: number | null } | null {
  const index = history.fresh[0];
  if (index == null) return null;
  const row = history.rows[index];
  if (!row) return null;
  const previous = history.rows.slice(index + 1).find((item) => item.suggestedKcal == null);
  return { index, row, before: previous ? previous.kcal : null };
}
