import { expect, test, type Page } from "@playwright/test";
import { pick } from "./dial";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog").last();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function setUp(page: Page, name: string) {
  const oid = `e2e-amount-tray-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  const food = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: { name, nutrientBasis: "per_100", basis: "g", kcalPer100: 100, proteinPer100: 10, fatPer100: 3, carbsPer100: 4 },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  await foodSheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
}

async function openFood(page: Page, name: string) {
  // On the My foods page: while the turn slides, Recent shows too and may list the same food.
  await foodSheet(page).locator('[data-food-page="mine"]').getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(foodSheet(page).getByRole("heading", { name })).toBeVisible();
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const dialog = [...document.querySelectorAll("[role=dialog]")].at(-1)!;
    const body = dialog.querySelector(".sheet-body")!.getBoundingClientRect();
    const lead = dialog.querySelector(".amount-screen .lead")!.getBoundingClientRect();
    const tray = dialog.querySelector("[data-amount-tray]")!.getBoundingClientRect();
    const page = dialog.querySelector(".amount-screen .page")!;
    const chips = dialog.querySelector("[data-amount-tray] .chips")!;
    return {
      leadGap: lead.top - body.top,
      trayBottom: tray.bottom,
      viewport: innerHeight,
      pageScrolls: page.scrollHeight > page.clientHeight + 1,
      chipLines: new Set([...chips.children].map((chip) => Math.round(chip.getBoundingClientRect().top))).size,
    };
  });
}

test("the amount tray stays at the bottom and the page starts at the top", async ({ page }) => {
  const name = "Fictional tray skyr";
  await setUp(page, name);
  await openFood(page, name);

  const sheet = foodSheet(page);
  const tray = sheet.locator("[data-amount-tray]");
  await expect(sheet.locator("[data-amount-box] [data-amount-pick]")).toHaveText("100");
  await expect(tray.getByRole("group", { name: "Quick amounts" }).getByRole("button", { name: "150 g", exact: true })).toBeVisible();
  await expect(tray.getByRole("button", { name: /^Add · \d+ kcal/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add a serving" })).toBeVisible();

  const tall = await geometry(page);
  expect(tall.leadGap).toBeLessThanOrEqual(4);
  expect(tall.trayBottom).toBeLessThanOrEqual(tall.viewport);
  expect(tall.chipLines).toBe(1);

  // A short screen: the page scrolls above the tray, and the tray keeps its buttons on screen.
  await page.setViewportSize({ width: 375, height: 520 });
  await expect(tray.getByRole("button", { name: /^Add · \d+ kcal/ })).toBeInViewport();
  const small = await geometry(page);
  expect(small.pageScrolls).toBe(true);
  expect(small.trayBottom).toBeLessThanOrEqual(small.viewport);
  expect(small.leadGap).toBeLessThanOrEqual(4);
});

test("the first quick amount is the one logged last time", async ({ page }) => {
  const name = "Fictional tray cottage cheese";
  await setUp(page, name);
  await openFood(page, name);

  const sheet = foodSheet(page);
  const field = sheet.locator("[data-amount-pick]");
  const chips = sheet.locator("[data-amount-tray]").getByRole("group", { name: "Quick amounts" });
  await expect(chips.getByRole("button", { name: /last time/ })).toHaveCount(0);
  await pick(page, field, 170);
  await expect(field).toHaveText("170");
  await sheet.getByRole("button", { name: /^Add · 170 kcal/ }).click();
  await expect(page.locator("[data-session] button.frow").filter({ hasText: "Fictional tray cottage cheese" })).toContainText("170 g");

  await openFood(page, name);
  const last = chips.getByRole("button").first();
  await expect(last).toHaveText("170 g · last time");
  await chips.getByRole("button", { name: "100 g", exact: true }).click();
  await expect(field).toHaveText("100");
  await last.click();
  await expect(field).toHaveText("170");
  await expect(sheet.getByRole("button", { name: /^Add · 170 kcal/ })).toBeVisible();

  // Editing an entry: the quick amounts are the plain ones.
  await sheet.getByRole("button", { name: "Back", exact: true }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.locator("main button.frow").filter({ hasText: name }).click();
  await expect(page.getByRole("dialog", { name: "Edit food" })).toBeVisible();
  await expect(foodSheet(page).getByRole("button", { name: /last time/ })).toHaveCount(0);

  // Picking it as a recipe ingredient: the same chip leads, found by search rather than recents.
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  await foodSheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: /Recipes/ }).click();
  await foodSheet(page).getByRole("button", { name: "New recipe" }).first().click();
  const recipe = page.getByRole("dialog", { name: "New recipe" });
  await recipe.getByRole("button", { name: "Add ingredient" }).click();
  await recipe.getByLabel("Search foods").fill(name);
  await recipe.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(recipe.getByRole("heading", { name })).toBeVisible();
  const picked = recipe.locator("[data-amount-tray]").getByRole("group", { name: "Quick amounts" });
  await expect(picked.getByRole("button").first()).toHaveText("170 g · last time");
  await picked.getByRole("button").first().click();
  await expect(recipe.locator("[data-amount-pick]")).toHaveText("170");
  await expect(recipe.getByRole("button", { name: /^Add to recipe · 170 kcal/ })).toBeVisible();
});
