import type { DescribeItem, DescribeLoggedItem, FoodSearchRow } from "../api";
import { addDays, dayMonth, timeInZone, todayInZone, weekdayShort } from "./dates";
import { macrosForFood } from "./foodAmount";
import { int } from "./format";

// "Describe a meal": the review list between Claude's answer and the log. Nothing here talks to the server.

export const DESCRIBE_TEXT_MAX = 500;

export const describePlaceholder = "What did you eat? For example: 2 eggs, toast with butter, coffee with milk";
export const describeHint = "Write it the way you'd say it. Amounts help: \"200 g\", \"2 slices\", \"a big bowl\". Anything without one gets a usual portion.";
export const describeNote = "Claude picks the foods and guesses amounts. Calories come from Matvaretabellen and your own foods.";
export const describeRetryPrompt = "Not what you meant?";
export const describeLeftShownAt = 5;
export const describeOfflineNote = "Describing a meal needs a connection. Your recent foods, My foods and Quick add work offline.";

/** A row on the review list. on is the check circle: a row that is off isn't added. */
export interface DescribeRow extends DescribeItem {
  on: boolean;
  /** Idempotency key for this row's log entry, kept across retries. */
  key: string;
}

export function rowsFrom(items: readonly DescribeItem[], newKey: () => string): DescribeRow[] {
  return items.map((item) => ({ ...item, on: item.food != null, key: newKey() }));
}

/** The rows Add will log: matched and checked. */
export function chosenRows(rows: readonly DescribeRow[]): (DescribeRow & { food: FoodSearchRow })[] {
  return rows.filter((row): row is DescribeRow & { food: FoodSearchRow } => row.on && row.food != null);
}

export function rowKcal(row: DescribeRow): number {
  return row.food ? macrosForFood(row.food, row.amount, row.unit).kcal : 0;
}

function foodsWord(count: number): string {
  return count === 1 ? "1 food" : `${count} foods`;
}

/** "5 foods" when everything matched, "2 of 3 found" when something didn't. */
export function reviewTitle(rows: readonly DescribeRow[]): string {
  const found = rows.filter((row) => row.food != null).length;
  return found === rows.length ? foodsWord(found) : `${found} of ${rows.length} found`;
}

/** "Add 5 foods · 458 kcal", or the verb alone when nothing is checked. */
export function addLabel(rows: readonly DescribeRow[], verb = "Add"): string {
  const chosen = chosenRows(rows);
  if (!chosen.length) return verb;
  const kcal = chosen.reduce((sum, row) => sum + rowKcal(row), 0);
  return `${verb} ${foodsWord(chosen.length)} · ${int(kcal)} kcal`;
}

/** "today", "yesterday", "Mon" within the week, then "12 Nov". */
export function whenLabel(loggedAt: string, today: string, timeZone: string): string {
  const moment = new Date(loggedAt);
  if (Number.isNaN(moment.getTime())) return "";
  const day = todayInZone(timeZone, moment);
  if (day === today) return "today";
  if (day === addDays(today, -1)) return "yesterday";
  if (day > addDays(today, -7) && day < today) return weekdayShort(day);
  return dayMonth(day);
}

/** "3 foods · 412 kcal · yesterday" under a recent description. */
export function recentLine(recent: { foods: number; kcal: number; loggedAt: string }, today: string, timeZone: string): string {
  const when = whenLabel(recent.loggedAt, today, timeZone);
  return [foodsWord(recent.foods), `${int(recent.kcal)} kcal`, when].filter(Boolean).join(" · ");
}

/** What the server keeps so this description can be used again with the same amounts. */
export function loggedItems(rows: readonly (DescribeRow & { food: FoodSearchRow })[]): DescribeLoggedItem[] {
  return rows.map((row) => ({
    phrase: row.phrase,
    name: row.name,
    guessed: row.guessed,
    foodId: row.food.id,
    amount: row.amount,
    unit: row.unit,
  }));
}

/** The text for Search when nothing matched: the plain name Claude gave, else the words typed. */
export function searchSeed(row: Pick<DescribeItem, "name" | "phrase">): string {
  const name = row.name.trim();
  return (name.length >= 2 ? name : row.phrase.trim()).slice(0, 80);
}

/**
 * The count under the button: nothing while plenty are left, "4 of 20 left today" from five down,
 * and when none are left, when the next one frees up ("back at 14:30", or "back tomorrow at 09:10").
 */
export function leftLine(quota: { limit: number; left: number; nextAt: string | null }, timeZone: string, now = new Date()): string {
  if (quota.limit <= 0 || quota.left > describeLeftShownAt) return "";
  if (quota.left > 0) return `${quota.left} of ${quota.limit} left today`;
  const next = quota.nextAt ? new Date(quota.nextAt) : null;
  if (!next || Number.isNaN(next.getTime())) return `That's all ${quota.limit} for now. Search still works.`;
  const sameDay = todayInZone(timeZone, next) === todayInZone(timeZone, now);
  return `That's all ${quota.limit} for now. Describe is back ${sameDay ? "" : "tomorrow "}at ${timeInZone(timeZone, next)}.`;
}
