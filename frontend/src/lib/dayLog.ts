import { addDays, dayMonth, dayNum, parse, weekStart, weekday } from "./dates";
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
  recalculation_adaptive: "Recalculated from your logs",
  recalculation_formula: "Recalculated from the formula",
};

export const fastingLabel = "Fasting day";
export const fastingHint = "Counts as 0 kcal. Logging food does not clear this.";

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

/**
 * The day to keep selected when the strip pages to `start` (that week's Monday).
 * Same weekday as `from` when that day can be chosen. A future day clamps to today.
 * A week that is entirely before setup has nothing to select.
 */
export function weekPageSelection(from: string, start: string, today: string, setupDate: string): string | null {
  const index = (parse(from).getDay() + 6) % 7;
  let candidate = addDays(start, index);
  const end = addDays(start, 6);
  if (candidate > today) candidate = today;
  if (setupDate && candidate < setupDate) {
    if (setupDate <= end && setupDate <= today) candidate = setupDate;
    else return null;
  }
  if (candidate < start || candidate > end || candidate > today) return null;
  return candidate;
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
    const letter = weekday(date)[0];
    const number = dayNum(date);
    let status = "nothing logged";
    if (future) status = "later";
    else if (beforeSetup) status = "before you set up";
    else if (loggedDay) status = "logged";
    if (date === today) status = future ? status : `${status}, today`;
    if (date === selected) status = `${status}, selected`;
    // The letter and the number are separate elements, and axe joins their text
    // with no space ("M" + "9" is "M9"). That string has to lead the name.
    return {
      date,
      letter,
      number,
      disabled,
      logged: loggedDay,
      label: `${letter}${number}, ${weekday(date)} ${number}, ${status}`,
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

/** The fasting mark is its own switch. It is never cleared because food was logged. */
export function nextFasting(turnOn: boolean): boolean {
  return turnOn;
}
