import { expect, type Locator, type Page } from "@playwright/test";

// The number wheel (README, *Picking a number*), as a test drives it: tap the number, type it, Enter.
// Not a spec: the specs that log sets import it.

/** Picks `value` for the button `target` (a set's kg, reps, time…), typed as a keyboard would: "62.5", or "130" for 1:30. */
export async function pick(page: Page, target: Locator, value: number | string): Promise<void> {
  await target.click();
  const dial = page.locator("[data-dial]");
  await expect(dial.locator("[data-dial-track]")).toBeFocused();
  const typed = String(value);
  await page.keyboard.type(typed);
  // The wheel has moved to it: a clock's digits (1:30 for "130"), else the same number (70.0 for "70").
  const digits = typed.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  await expect.poll(async () => {
    const shown = await dial.locator("[data-dial-value]").innerText();
    if (shown.includes(":")) return shown.replace(/\D/g, "").replace(/^0+(?=\d)/, "") === digits;
    return Number.parseFloat(shown.replace(/[^\d.½]/g, "").replace("½", ".5")) === Number.parseFloat(typed);
  }).toBe(true);
  await page.keyboard.press("Enter");
  await expect(dial).toHaveCount(0);
}

/** The set on the timeline: `[data-set]` of an exercise (by its id), by index. */
export function setRow(scope: Page | Locator, exerciseId: string, index: number): Locator {
  return scope.locator(`[data-set="${index}"][data-exercise="${exerciseId}"]`);
}
