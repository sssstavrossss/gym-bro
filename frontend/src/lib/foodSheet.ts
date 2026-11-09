import {
  amountLabel,
  defaultAmount,
  macroFigure,
  macrosForFood,
  normalizeUnit,
  unitsForFood,
  type CatalogFood,
} from "./foodAmount";
import { int } from "./format";
import { preparedSearch } from "./foodSearch";

export interface RecentAddInput {
  foodId: string;
  name: string;
  amount: number;
  unit: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  date: string;
  today: string;
  timeZone: string;
  pickedTime: string | null;
  idempotencyKey: string;
}

export interface RecentAddBody {
  idempotencyKey: string;
  localDate: string;
  timeZone: string;
  time: string | null;
  name: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  foodId: string;
  amount: number;
  unit: string;
}

export type RecentAddResult =
  | { ok: true; body: RecentAddBody }
  | { ok: false; needTime: true };

/**
 * Today may leave the time empty so the server stamps now.
 * A past day must already have a picked time. It is never filled with now.
 */
export function logTimeForAdd(date: string, today: string, picked: string | null): { ok: true; time: string | null } | { ok: false; needTime: true } {
  if (date === today) return { ok: true, time: picked };
  if (picked) return { ok: true, time: picked };
  return { ok: false, needTime: true };
}

/** Past days keep Add disabled until a time is picked. Today can still mean now. Editing already has a time. */
export function addNeedsTime(date: string, today: string, picked: string | null, editing: boolean): boolean {
  if (editing || date === today) return false;
  return !picked;
}

/** A second tap inside the window is the same add. The idempotency key stays until that add finishes. */
export function sameAddTap(lastAt: number, now: number, windowMs = 600): boolean {
  return lastAt > 0 && now - lastAt < windowMs;
}

export function recentAddBody(input: RecentAddInput): RecentAddResult {
  const time = logTimeForAdd(input.date, input.today, input.pickedTime);
  if (!time.ok) return time;
  return {
    ok: true,
    body: {
      idempotencyKey: input.idempotencyKey,
      localDate: input.date,
      timeZone: input.timeZone,
      time: time.time,
      name: input.name,
      kcal: input.kcal,
      protein: input.protein,
      fat: input.fat,
      carbs: input.carbs,
      foodId: input.foodId,
      amount: input.amount,
      unit: input.unit,
    },
  };
}

/** Last logged unit when the food still offers it. Otherwise the food's usual amount. */
export function amountForRecent(food: CatalogFood, amount: number, unit: string): { amount: string; unit: "g" | "ml" | "serving" | "piece" } {
  const kind = normalizeUnit(unit);
  if (kind && amount > 0 && unitsForFood(food).some((choice) => choice.unit === kind)) {
    return { amount: String(amount), unit: kind };
  }
  return defaultAmount(food);
}

/** "180 g · 297 kcal · P56 F6 C0" for the amount a one-tap add will log. */
export function recentSubtitle(food: CatalogFood, amount: number, unit: string): string {
  const picked = amountForRecent(food, amount, unit);
  const macros = macrosForFood(food, Number(picked.amount), picked.unit);
  const grams = macros.grams != null && picked.unit !== "g" && picked.unit !== "ml" ? ` (${int(macros.grams)} g)` : "";
  return `${amountLabel(Number(picked.amount), picked.unit)}${grams} · ${int(macros.kcal)} kcal · P${macroFigure(macros.protein)} F${macroFigure(macros.fat)} C${macroFigure(macros.carbs)}`;
}

export const recentEmptyTitle = "Nothing here yet";
export const recentEmptyDetail = "Search for a food above. Foods you log show up here with your last amount, so next time it's one tap.";
export const recentHintTouch = "+ adds your last amount";
export const recentHintKeys = "↑↓ choose · Enter amount · Shift+Enter last amount";

export type OffStatus = "idle" | "loading" | "ok" | "rate_limited" | "unavailable";

export interface OffDemand<T> {
  query: string;
  status: OffStatus;
  missingKcal: number;
  results: T[];
}

export function idleOff<T>(query = ""): OffDemand<T> {
  return { query, status: "idle", missingKcal: 0, results: [] };
}

/** Typing searches the local catalogue only. A changed query drops a previous outside result. */
export function typeForLocalSearch<T>(current: OffDemand<T>, query: string): OffDemand<T> {
  if (current.query.trim() === query.trim()) return { ...current, query };
  return { query, status: "idle", missingKcal: 0, results: [] };
}

export function canAskOpenFoodFacts(query: string): boolean {
  return preparedSearch(query).kind === "query";
}

/** Null when the text is too short to send. Otherwise a loading state. Does not run on its own. */
export function beginOffRequest<T>(current: OffDemand<T>): OffDemand<T> | null {
  if (!canAskOpenFoodFacts(current.query)) return null;
  return { ...current, status: "loading", missingKcal: 0, results: [] };
}

export function finishOffRequest<T extends { id: string }>(
  current: OffDemand<T>,
  response: { query: string; status: "ok" | "rate_limited" | "unavailable"; missingKcal: number; results: T[] },
): OffDemand<T> {
  if (current.query.trim() !== response.query.trim()) return current;
  if (response.status !== "ok") {
    return { ...current, status: response.status, missingKcal: 0, results: [] };
  }
  return { ...current, status: "ok", missingKcal: response.missingKcal, results: response.results };
}

export function packagedBesideLocal<T extends { id: string }>(local: { id: string }[], remote: T[]): T[] {
  const seen = new Set(local.map((row) => row.id));
  const kept: T[] = [];
  for (const row of remote) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    kept.push(row);
  }
  return kept;
}

export const missingKcalLead = "Not shown: missing calories →";
export const missingKcalAction = "create my food";
export const missingKcalNotice = `${missingKcalLead} ${missingKcalAction}`;

export const myFoodsEmptyTitle = "No foods of your own yet";
export const myFoodsEmptyDetail = "Create one for a home recipe or anything the database doesn't have. Only you see them.";

export function isMyFood(food: { source: string; owned?: boolean }): boolean {
  return food.owned === true || food.source === "custom";
}

export function withBrand(brand: string | null | undefined, detail: string): string {
  const text = brand?.trim();
  return text ? `${text} · ${detail}` : detail;
}

/** A skipped Open Food Facts product opens the editor with its name only. No calories are invented. */
export function missingKcalEditorSeed(query: string): { name: string } | null {
  const name = query.trim();
  return name ? { name } : null;
}

export function offFailureCopy(_status: "rate_limited" | "unavailable"): { title: string; detail: string; retry: string; quickAdd: string } {
  return {
    title: "Can't reach the food database",
    detail: "Showing foods you've used before. Packaged foods need the online database.",
    retry: "Try again",
    quickAdd: "Quick Add instead",
  };
}

/** Keep a name the person already typed. Otherwise carry the search text into Quick Add. */
export function quickAddName(currentName: string, query: string): string {
  if (currentName.trim()) return currentName;
  return query.trim();
}
