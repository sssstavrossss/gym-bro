import { expect, type Locator, type Page } from "@playwright/test";

// The workout timeline's menus (README, *Logging a workout*), as a test drives them. Not a spec: the workout specs
// import it. The menus float over the sheet, outside its dialog, so they are found on the page.

/** The menu open over the page. */
export function menu(page: Page): Locator {
  return page.locator("[data-menu]");
}

/** Taps the timeline's one + and picks `item` from its menu: "add-exercise", "add-set", "add-warmup", "describe-workout"… */
export async function addToWorkout(page: Page, item: string): Promise<void> {
  await page.locator("[data-timeline] [data-timeline-add]").click();
  await menu(page).locator(`[data-menu-item="${item}"]`).click();
  await expect(menu(page)).toHaveCount(0);
}

/** Opens an exercise's menu from its photo on the rail (by the exercise's id) and returns the menu. */
export async function exerciseMenu(page: Page, exerciseId: string): Promise<Locator> {
  await page.locator(`[data-timeline] [data-exercise-menu="${exerciseId}"]`).click();
  await expect(menu(page)).toBeVisible();
  return menu(page);
}

/** Picks `item` from an exercise's menu: "how-to", "swap", "rest", "superset", "remove". */
export async function fromExerciseMenu(page: Page, exerciseId: string, item: string): Promise<void> {
  await (await exerciseMenu(page, exerciseId)).locator(`[data-menu-item="${item}"]`).click();
  await expect(menu(page)).toHaveCount(0);
}

/** Closes the menu open, as Esc does. */
export async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
}
