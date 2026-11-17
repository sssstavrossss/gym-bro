import { addDays } from "./dates";
import { lastPlanDate } from "./dayLog";

/** Tomorrow (to plan it), today, then earlier days back to setup. Further ahead is "Another date". */
export function copyDates(today: string, setup: string | null | undefined, count = 7): string[] {
  const earliest = setup && setup <= today ? setup : today;
  const days: string[] = [addDays(today, 1)];
  for (let i = 0; i < count; i += 1) {
    const day = addDays(today, -i);
    if (day < earliest || day > today) break;
    days.push(day);
  }
  return days;
}

export function acceptCopyDate(value: string, today: string, setup: string | null | undefined): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value > lastPlanDate(today)) return false;
  if (setup && value < setup) return false;
  return true;
}

export function copyDayLabel(day: string, today: string): "Tomorrow" | "Today" | "Yesterday" | null {
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return null;
}
