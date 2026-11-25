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

/** How far a finger drags for a whole page turn: most of the screen, so the roll follows it closely. */
export function fanDragSpan(width: number): number {
  return Math.max(160, Math.min(280, width * 0.6));
}

/**
 * A sideways drag as a page turn in progress: `dir` 1 turns forward (the finger goes left, as on every
 * other pager), and `t` runs from 0 (the page as it was) to 1 (the next page in place).
 */
export function fanDrag(dx: number, span: number): { dir: 1 | -1; t: number } {
  return { dir: dx < 0 ? 1 : -1, t: Math.min(1, Math.abs(dx) / Math.max(1, span)) };
}

/** On release, the turn finishes past a third of the way, or on a flick that way (px per ms); otherwise it springs back. */
export function fanSettles(t: number, velocity: number, dir: 1 | -1): boolean {
  const flick = -velocity * dir;
  if (flick > 0.35) return true;
  if (flick < -0.35) return false;
  return t > 1 / 3;
}

/**
 * A button fades as it rolls towards either end of the half ring, and is gone `floor` degrees above it,
 * so nothing shows over the tab bar. It is whole from the outer spots (36°) in, so a drag's first move
 * doesn't dim them.
 */
export function fanFade(angle: number, floor = 12, band = 24): number {
  return Math.max(0, Math.min(1, (Math.min(angle, 180 - angle) - floor) / band));
}

/**
 * Mid-drag, the page further from its place dims, so the turn reads as one page handing over to the
 * next rather than ten buttons at once. `share` is how much of the turn belongs to this page (1 - t for
 * the one leaving, t for the one coming in).
 */
export function fanDim(share: number): number {
  return 0.35 + 0.65 * Math.max(0, Math.min(1, share));
}
