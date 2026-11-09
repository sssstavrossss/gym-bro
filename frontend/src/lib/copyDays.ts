import { addDays } from "./dates";

/** Today first, then earlier days, never a future day and never before setup. */
export function copyDates(today: string, setup: string | null | undefined, count = 7): string[] {
  const earliest = setup && setup <= today ? setup : today;
  const days: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addDays(today, -i);
    if (day < earliest || day > today) break;
    days.push(day);
  }
  return days;
}

export function acceptCopyDate(value: string, today: string, setup: string | null | undefined): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value > today) return false;
  if (setup && value < setup) return false;
  return true;
}

export function copyDayLabel(day: string, today: string): "Today" | "Yesterday" | null {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return null;
}
