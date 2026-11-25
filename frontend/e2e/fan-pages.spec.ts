import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 } });

async function setup(page: Page) {
  const oid = `e2e-fan-pages-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  return oid;
}

async function savedFan(page: Page, oid: string) {
  return (await (await page.request.get("/api/profile", { headers: headers(oid) })).json()).profile.fanPages;
}

/** Drags a row by its grip until its middle sits over `to` (a fraction down the target line). Boxes are read in one frame, once the sheet is still. */
async function dragGrip(page: Page, id: string, target: string, fraction: number) {
  const sheet = page.locator("[data-fan-pages-sheet]");
  await sheet.locator(`[data-fan-row="${id}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const at = await sheet.evaluate((el, { id, target, fraction }) => {
    const grip = el.querySelector(`[data-fan-row="${id}"] [data-grip]`)!.getBoundingClientRect();
    const over = el.querySelector(target)!.getBoundingClientRect();
    return { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2, to: over.y + over.height * fraction };
  }, { id, target, fraction });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.to, { steps: 10 });
}

test("the fan's cog arranges its pages: off, across pages, a new page, and it follows the account", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);
  await page.goto("/today");

  const fan = page.getByRole("dialog", { name: "Add" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(fan.getByRole("button", { name: "Page 1 of 2" })).toBeVisible();

  // The cog sits on the +'s axis, between the dots and the ×.
  const cog = fan.getByRole("button", { name: "Arrange the + button" });
  const parts = await fan.evaluate((el) => {
    const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
    return { cog: box("[data-fan-cog]"), dots: box(".fdots"), close: box(".fclose") };
  });
  expect(Math.abs(parts.cog.x + parts.cog.width / 2 - (parts.close.x + parts.close.width / 2))).toBeLessThan(1);
  expect(parts.cog.y).toBeGreaterThanOrEqual(parts.dots.y + parts.dots.height - 1);
  expect(parts.cog.y + parts.cog.height).toBeLessThanOrEqual(parts.close.y + 1);
  expect(parts.cog.height).toBeGreaterThanOrEqual(44);

  await cog.click();
  const sheet = page.getByRole("dialog", { name: "+ button" });
  await expect(sheet).toBeVisible();
  const live = sheet.locator("[aria-live]");
  await expect(sheet.locator("[data-fan-page]")).toHaveCount(2);
  await expect(sheet.locator("[data-fan-reset]")).toHaveCount(0);

  // − takes Weight off the fan; page one is now four of five.
  await sheet.getByRole("button", { name: "Take Weight off the fan" }).click();
  await expect(live).toHaveText("Weight, not in the fan");
  await expect(sheet.locator('[data-fan-page="1"]')).toContainText("4 of 5");

  // ↑ on New recipe's grip moves it to the end of page one; focus stays on the grip.
  const recipeGrip = sheet.locator('[data-fan-row="recipe"] [data-grip]');
  await recipeGrip.focus();
  await page.keyboard.press("ArrowUp");
  await expect(live).toHaveText("New recipe, page 1, 5 of 5");
  await expect(recipeGrip).toBeFocused();
  await expect(sheet.locator('[data-fan-page="1"]')).toContainText("5 of 5");

  // Page one is full: dragging Groups onto it says so, and letting go changes nothing.
  await dragGrip(page, "groups", '[data-fan-row="scan"]', 0.5);
  await expect(sheet.locator('[data-fan-page="1"]')).toContainText("Full");
  await page.mouse.up();
  await expect(sheet.locator('[data-fan-page="1"]')).toContainText("5 of 5");

  // Groups dragged onto the slot starts page three.
  await dragGrip(page, "groups", "[data-fan-new]", 0.75);
  await page.mouse.up();
  await expect(sheet.locator("[data-fan-page]")).toHaveCount(3);
  await expect(live).toHaveText("Groups, page 3, 1 of 1");
  const mine = ["search,scan,describe,quick,recipe", "food,recipes,mine", "groups"];
  await expect.poll(() => savedFan(page, oid)).toEqual(mine);

  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);

  // Esc goes back to the fan, which has three pages; the third is Groups alone.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(fan.getByRole("button", { name: "Page 1 of 3" })).toHaveAttribute("aria-current", "true");
  await expect(fan.getByRole("button", { name: "Weight", exact: true })).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(fan.getByRole("button", { name: "Groups", exact: true })).toBeVisible();
  await expect(fan.locator(".fi.here")).toHaveCount(1);

  // It follows a reload, and Settings sums it up.
  await page.reload();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(fan.getByRole("button", { name: "Page 1 of 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fan).toHaveCount(0);
  await page.getByRole("link", { name: /Profile/ }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const row = settings.locator("[data-fan-settings]");
  await expect(row).toContainText("3 pages · 9 buttons");

  // Reset, from Settings, brings the default two pages back.
  await row.click();
  await expect(sheet).toBeVisible();
  await sheet.locator("[data-fan-reset]").click();
  await expect(live).toHaveText("Default pages");
  await expect(sheet.locator("[data-fan-page]")).toHaveCount(2);
  await expect.poll(() => savedFan(page, oid)).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(settings.locator("[data-fan-settings]")).toContainText("2 pages · 10 buttons");
});
