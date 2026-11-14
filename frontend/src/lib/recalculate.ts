export const recalculateBannerText = "Time to recalculate your target";

/** The card stays up for the week unless this week's recalculation or dismissal already happened. */
export function bannerVisible(recalculatedThisWeek: boolean, dismissedThisWeek: boolean): boolean {
  return !recalculatedThisWeek && !dismissedThisWeek;
}

export function unreadCount(items: readonly { readAt: string | null }[]): number {
  return items.filter((item) => item.readAt == null).length;
}

export interface ReviewDay {
  date: string;
  kcal: number;
  targetKcal: number | null;
  fasting: boolean;
  canExclude: boolean;
  included: boolean;
}

/** Excluded dates are the listed days the person unticked. */
export function excludedDates(days: readonly ReviewDay[], ticked: ReadonlySet<string>): string[] {
  return days.filter((day) => day.canExclude && ticked.has(day.date)).map((day) => day.date);
}

export function withExclusions(days: readonly ReviewDay[], ticked: ReadonlySet<string>): ReviewDay[] {
  const excluded = new Set(excludedDates(days, ticked));
  return days.map((day) => ({ ...day, included: day.canExclude ? !excluded.has(day.date) : day.included }));
}
