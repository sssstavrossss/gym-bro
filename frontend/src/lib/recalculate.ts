export interface ReviewDay {
  date: string;
  kcal: number;
  targetKcal: number | null;
  fasting: boolean;
  canExclude: boolean;
  included: boolean;
}

/** Excluded dates are the under-target days the person ticked. Fasting cannot be excluded. */
export function excludedDates(days: readonly ReviewDay[], ticked: ReadonlySet<string>): string[] {
  return days.filter((day) => day.canExclude && ticked.has(day.date)).map((day) => day.date);
}

export function withExclusions(days: readonly ReviewDay[], ticked: ReadonlySet<string>): ReviewDay[] {
  const excluded = new Set(excludedDates(days, ticked));
  return days.map((day) => ({ ...day, included: day.canExclude ? !excluded.has(day.date) : day.included }));
}
