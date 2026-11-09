import { addDays, dayMonth, dayNum, weekStart, weekday } from "./dates";
import { int } from "./format";
import { macroStatus, type MacroKind } from "./macros";

export interface DayNumbers {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

export interface DayTargetNumbers {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  effectiveDate: string;
  reason?: string;
}

export interface SummaryCell {
  key: MacroKind;
  value: string;
  caption: string;
  over: boolean;
}

export interface WeekDay {
  date: string;
  letter: string;
  number: number;
  disabled: boolean;
  logged: boolean;
  label: string;
}

const REASON: Record<string, string> = {
  profile_change: "Profile change",
  macro_balance_change: "Macro balance change",
  weekly_recalculation: "Weekly update",
  fresh_start: "Fresh start",
};

export const dayCompleteLabel = "Day complete";
export const dayCompleteHint = "Everything eaten is logged. Unmarked days count as missing, never as zero.";
export const fastingQuestion = "Mark as a fasting day (0 kcal)?";

/** A date the screens may show. Future days and days before setup are not offered. */
export function clampLogDate(date: string, today: string, setupDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return today;
  if (setupDate && date < setupDate) return setupDate;
  return date;
}

/** Null when the step would leave the allowed window, including any move into the future. */
export function shiftLogDate(date: string, by: number, today: string, setupDate: string): string | null {
  const next = clampLogDate(addDays(date, by), today, setupDate);
  return next === date ? null : next;
}

export function weekDays(
  anchor: string,
  selected: string,
  today: string,
  setupDate: string,
  loggedDates: readonly string[],
): WeekDay[] {
  const start = weekStart(anchor);
  const logged = new Set(loggedDates);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const future = date > today;
    const beforeSetup = Boolean(setupDate) && date < setupDate;
    const disabled = future || beforeSetup;
    const loggedDay = !disabled && logged.has(date);
    let status = "nothing logged";
    if (future) status = "later";
    else if (beforeSetup) status = "before you set up";
    else if (loggedDay) status = "logged";
    if (date === today) status = future ? status : `${status}, today`;
    if (date === selected) status = `${status}, selected`;
    return {
      date,
      letter: weekday(date)[0],
      number: dayNum(date),
      disabled,
      logged: loggedDay,
      label: `${weekday(date)} ${dayNum(date)}, ${status}`,
    };
  });
}

export function summaryCells(totals: DayNumbers, target: DayTargetNumbers | null): SummaryCell[] {
  const rows: { key: MacroKind; current: number; goal: number | null; unit: string }[] = [
    { key: "kcal", current: totals.kcal, goal: target?.kcal ?? null, unit: "kcal" },
    { key: "p", current: totals.p, goal: target?.protein ?? null, unit: "P" },
    { key: "f", current: totals.f, goal: target?.fat ?? null, unit: "F" },
    { key: "c", current: totals.c, goal: target?.carbs ?? null, unit: "C" },
  ];
  return rows.map((row) => ({
    key: row.key,
    value: int(row.current),
    caption: row.goal == null ? row.unit : `/ ${int(row.goal)} ${row.unit}`,
    over: row.goal != null && macroStatus(row.key, row.current, row.goal) === "over",
  }));
}

/** Days before the first target are shown, not judged. */
export function targetLine(target: DayTargetNumbers | null, firstTargetDate: string | null): string {
  if (!target) {
    return firstTargetDate
      ? `No target on this day · targets start ${dayMonth(firstTargetDate)}`
      : "No target on this day";
  }
  const reason = REASON[target.reason ?? ""] ?? "";
  const since = `Target ${int(target.kcal)} kcal · since ${dayMonth(target.effectiveDate)}`;
  return reason ? `${since} · ${reason}` : since;
}

export function dayTotalText(kcal: number, count: number): string {
  const items = count === 1 ? "item" : "items";
  return `${int(kcal)} kcal · ${count} ${items}`;
}

export function byTime<T extends { time: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export type CompletePlan =
  | { kind: "clear" }
  | { kind: "save" }
  | { kind: "ask" };

/** Ticking an empty day asks the fasting question. A day with food saves complete only. */
export function planDayComplete(turnOn: boolean, entryCount: number): CompletePlan {
  if (!turnOn) return { kind: "clear" };
  if (entryCount <= 0) return { kind: "ask" };
  return { kind: "save" };
}

/** Declining the fasting question saves nothing. Yes stores complete and fasting. */
export function fastingChoice(yes: boolean): { save: false } | { save: true; complete: true; fasting: true } {
  if (!yes) return { save: false };
  return { save: true, complete: true, fasting: true };
}
