import { reactive } from "vue";
import { getTargets, listLogEntries } from "../api";
import type { DayTarget, MacroTotals } from "../lib/weekCard";

export interface WeekDayData {
  logged: boolean;
  eaten: MacroTotals | null;
  target: DayTarget | null;
}

export const weekCache = reactive({
  stamp: 0,
  days: {} as Record<string, WeekDayData>,
});

let request = 0;

/** Loads each day's own target and totals with the endpoints the app already has. */
export async function loadWeekDays(dates: readonly string[], logged: ReadonlySet<string>): Promise<void> {
  const gen = ++request;
  const rows = await Promise.all(dates.map(async (date) => {
    const data: WeekDayData = { logged: logged.has(date), eaten: null, target: null };
    try {
      const targets = await getTargets(date);
      if (targets.targets) {
        data.target = {
          kcal: targets.targets.kcal,
          protein: targets.targets.protein,
          fat: targets.targets.fat,
          carbs: targets.targets.carbs,
        };
      }
      if (logged.has(date)) {
        const list = await listLogEntries(date);
        data.eaten = {
          kcal: list.totals.kcal,
          protein: list.totals.protein,
          fat: list.totals.fat,
          carbs: list.totals.carbs,
        };
        data.logged = list.entries.length > 0 || data.logged;
      }
    } catch {
      // Leave target empty. The open day still uses the figures already on screen.
    }
    return [date, data] as const;
  }));
  if (gen !== request) return;
  for (const [date, data] of rows) weekCache.days[date] = data;
  weekCache.stamp += 1;
}
