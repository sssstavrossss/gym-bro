import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
  });
}

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

async function putProfile(request: APIRequestContext, oid: string, zone: string) {
  const response = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      activity: "moderate",
      goal: "lose",
      rateKgPerWeek: 0.5,
      goalWeightKg: 80,
      proteinSetting: "normal",
      proteinGramsPerKg: 2,
      fatSetting: "normal",
      fatPercent: 25,
      timeZone: zone,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, zone: string) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg: 83.6, timeZone: zone },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function createFood(request: APIRequestContext, oid: string, name: string) {
  const response = await request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name,
      kcalPer100: 200,
      proteinPer100: 20,
      fatPer100: 5,
      carbsPer100: 10,
      basis: "g",
      nutrientBasis: "per_100",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => ({
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.slice(0, 3).map((node) => node.html),
  })))).toEqual([]);
}

async function insideSheet(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => {
    const scroller = el.closest(".sheet-body");
    if (!scroller) return false;
    const row = el.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    return row.top >= frame.top - 1 && row.bottom <= frame.bottom + 1;
  });
}

for (const size of [
  { width: 375, height: 667, label: "375x667" },
  { width: 390, height: 844, label: "390x844" },
]) {
  test(`recipe sheet scrolls on a phone ${size.label}`, async ({ page }) => {
    const oid = `e2e-scroll-${size.width}-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await putWeighIn(page.request, oid, when.today, when.zone);
    await putProfile(page.request, oid, when.zone);
    const foodName = `Fictional scroll oats ${size.width}`;
    await createFood(page.request, oid, foodName);

    await sign(page, oid);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/log");
    await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
    await page.getByRole("button", { name: "Add food", exact: true }).click();
    const food = page.getByRole("dialog", { name: "Add food" });
    await food.getByRole("searchbox", { name: "Search foods" }).blur();
    await food.getByRole("button", { name: /Recipes/ }).click();
    await food.getByRole("button", { name: "New recipe" }).first().click();
    const sheet = page.getByRole("dialog", { name: "New recipe" });

    for (let i = 0; i < 6; i++) {
      await sheet.getByRole("button", { name: "Add ingredient" }).click();
      await sheet.getByLabel("Search foods").fill(foodName);
      await sheet.getByRole("button", { name: new RegExp(foodName) }).click();
      await sheet.getByLabel(`Amount of ${foodName}`).fill(String(40 + i));
      await sheet.getByRole("button", { name: "Add to recipe" }).click();
    }

    await sheet.getByLabel("Recipe name").fill("Big pot");
    await sheet.getByLabel("Portions").fill("6");

    const body = sheet.locator(".sheet-body");
    const overflow = await body.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
      overscroll: getComputedStyle(el).overscrollBehaviorY,
    }));
    expect(overflow.scroll).toBeGreaterThan(overflow.client);
    expect(overflow.overscroll).toBe("contain");

    const last = sheet.locator("[data-ingredient-index='5']");
    const add = sheet.getByRole("button", { name: "Add ingredient" });
    expect(await insideSheet(page, "[data-ingredient-index='5']")).toBe(false);

    const pageBefore = await page.locator(".scroller").evaluate((el) => el.scrollTop);
    await last.scrollIntoViewIfNeeded();
    expect(await insideSheet(page, "[data-ingredient-index='5']")).toBe(true);
    await expect(sheet.getByRole("button", { name: "Save recipe" })).toBeInViewport();

    await add.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport();
    await body.hover();
    await page.mouse.wheel(0, 80);
    expect(await page.locator(".scroller").evaluate((el) => el.scrollTop)).toBe(pageBefore);
    await last.scrollIntoViewIfNeeded();
    expect(await insideSheet(page, "[data-ingredient-index='5']")).toBe(true);
    await expect(sheet.getByRole("button", { name: "Save recipe" })).toBeInViewport();
    const saveBox = await sheet.getByRole("button", { name: "Save recipe" }).boundingBox();
    expect(saveBox && saveBox.height >= 44 && saveBox.width >= 44).toBeTruthy();
    expect(await page.locator(".scroller").evaluate((el) => el.scrollTop)).toBe(pageBefore);
    await expectClean(page);

    await sheet.getByRole("button", { name: "Save recipe" }).click();
    await expect(page.getByText(/Saved “Big pot”/)).toBeVisible();
    const recipes = await page.request.get("/api/recipes", { headers: headers(oid) });
    const saved = (await recipes.json()).recipes as { name: string; ingredients: unknown[] }[];
    expect(saved.some((recipe) => recipe.name === "Big pot" && recipe.ingredients.length === 6)).toBeTruthy();
  });
}
