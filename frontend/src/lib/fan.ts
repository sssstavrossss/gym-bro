/**
 * The + fan: the tab bar's + opens a half ring of buttons around itself, five to a page. More pages
 * sit behind dots and roll along the ring when you swipe, wrapping like every other pager in the app.
 */
export type FanActionId = "search" | "scan" | "describe" | "quick" | "weight" | "recipe" | "food" | "recipes" | "mine" | "groups";

export interface FanAction {
  id: FanActionId;
  label: string;
  icon: string;
}

/** In order: the first five are page one. Each keeps its spot, so a thumb learns where it is. */
export const FAN_ACTIONS: readonly FanAction[] = [
  { id: "search", label: "Search", icon: "search" },
  { id: "scan", label: "Scan", icon: "scan" },
  { id: "describe", label: "Describe", icon: "sparkle" },
  { id: "quick", label: "Quick add", icon: "plus" },
  { id: "weight", label: "Weight", icon: "scale" },
  { id: "recipe", label: "New recipe", icon: "food" },
  { id: "food", label: "New food", icon: "edit" },
  { id: "recipes", label: "Recipes", icon: "list" },
  { id: "mine", label: "My foods", icon: "user" },
  { id: "groups", label: "Groups", icon: "layers" },
];

export const FAN_PER_PAGE = 5;
/** Degrees between neighbouring buttons on the ring. */
export const FAN_STEP = 27;
/** How far round the ring a page rolls as it leaves or arrives, in degrees. */
export const FAN_ROLL = 150;
export const FAN_RADIUS = 176;

/** On a ring squeezed by a narrow screen the buttons shrink with it, to no less than 80%, so they don't touch. */
export function fanScale(radius: number): number {
  return Math.max(0.8, Math.min(1, radius / FAN_RADIUS));
}

/** The actions to show: Describe only when the server can describe meals. */
export function fanActions(describeOn: boolean): FanAction[] {
  return FAN_ACTIONS.filter((action) => describeOn || action.id !== "describe");
}

export function fanPages<T>(items: readonly T[], per = FAN_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let at = 0; at < items.length; at += per) pages.push(items.slice(at, at + per));
  return pages;
}

/**
 * The angle of spot `at` of `count` on a page, in degrees counter-clockwise from the right (90 is
 * straight up). Spots are FAN_STEP apart and centred on straight up, first on the left.
 */
export function fanAngle(at: number, count: number, step = FAN_STEP): number {
  return 90 + ((count - 1) / 2 - at) * step;
}

/**
 * The ring's radius: FAN_RADIUS where there is room (neighbours then sit far enough apart that a label
 * clears the next button), smaller on a narrow screen so the outer buttons' labels (`half` is half a
 * button's width) stay `gutter` inside the edge.
 */
export function fanRadius(width: number, centreX: number, count = FAN_PER_PAGE, half = 40, gutter = 8): number {
  const spread = (((count - 1) / 2) * FAN_STEP * Math.PI) / 180;
  if (spread <= 0) return FAN_RADIUS;
  const room = Math.min(centreX, width - centreX) - half - gutter;
  return Math.round(Math.max(112, Math.min(FAN_RADIUS, room / Math.sin(spread))));
}

/** The page after a swipe or arrow key, wrapping past either end. */
export function fanTurn(page: number, by: number, pages: number): number {
  if (pages < 1) return 0;
  return (((page + by) % pages) + pages) % pages;
}
