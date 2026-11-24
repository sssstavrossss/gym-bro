/**
 * Add food's Search tab is four pages you swipe between (they wrap like a carousel), named by a row
 * of chips above them. The page also sets what the search box looks through, as the chips did before.
 */
export const FOOD_PAGES = [
  { id: "recent", label: "Recent", search: "Search foods" },
  { id: "recipes", label: "Recipes", search: "Search recipes" },
  { id: "mine", label: "My foods", search: "Search my foods" },
  { id: "groups", label: "Groups", search: "Search groups" },
] as const;

export type FoodPage = (typeof FOOD_PAGES)[number]["id"];

/** Only Recent searches the food database; the other pages filter their own list as you type. */
export function searchesServer(page: FoodPage): boolean {
  return page === "recent";
}

/** The page a pager position shows, for a position that may run past either end while wrapping. */
export function pageAt(position: number, count: number): number {
  if (count < 1) return 0;
  return ((Math.round(position) % count) + count) % count;
}

/**
 * Where the highlight pill sits, in chip widths from the first chip, for a pager position.
 * The position runs from -1 to `count` while a wrap slides past an end: then a second pill
 * enters from the far side, so the pill leaves one end and comes back in at the other.
 */
export function pillSpots(position: number, count: number): number[] {
  if (count < 1 || !Number.isFinite(position)) return [0];
  const main = Math.max(-1, Math.min(count, position));
  if (main > count - 1) return [main, main - count];
  if (main < 0) return [main, main + count];
  return [main];
}

/** How much of chip `at` the pill covers (0 to 1), from `pillSpots`: its label takes the pill's ink by as much. */
export function pillCover(spots: number[], at: number): number {
  return Math.min(1, spots.reduce((sum, spot) => sum + Math.max(0, 1 - Math.abs(spot - at)), 0));
}

export const newRecipeDetail = "Type it in, paste a list, or import a link";
export const newFoodDetail = "Type it in, or fill it from a label photo";
export const groupsEmptyTitle = "No groups yet";
export const groupsEmptyDetail = "Add two or more foods, then tap Save as group under the list. A group adds them all again in one tap.";

/** The quiet line under the groups: what + does, and when ("now", "at 12:30"). */
export function groupsNote(when: string): string {
  return `+ adds every item ${when}`;
}
