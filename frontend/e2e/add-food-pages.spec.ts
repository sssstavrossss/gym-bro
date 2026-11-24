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

async function setUp(request: APIRequestContext, oid: string, today: string, zone: string) {
  const weighIn = await request.put(`/api/weigh-ins/${today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: zone } });
  expect(weighIn.ok(), await weighIn.text()).toBeTruthy();
  const profile = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose", rateKgPerWeek: 0.5, goalWeightKg: 80,
      proteinSetting: "normal", proteinGramsPerKg: 2, fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
}

async function createFood(request: APIRequestContext, oid: string, name: string): Promise<string> {
  const response = await request.post("/api/foods", {
    headers: headers(oid),
    data: { name, kcalPer100: 120, proteinPer100: 10, fatPer100: 4, carbsPer100: 11, basis: "g", nutrientBasis: "per_100" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).id as string;
}

async function logFood(request: APIRequestContext, oid: string, today: string, zone: string, foodId: string) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: { idempotencyKey: `pages-${foodId}`, localDate: today, timeZone: zone, time: "08:00", foodId, amount: 150, unit: "g", kcal: 180, protein: 15, fat: 6, carbs: 17 },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test("Add food's lists are four swipe pages named by chips, wrapping like a carousel", async ({ page }) => {
  const oid = `e2e-food-pages-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  const oats = await createFood(page.request, oid, "Fictional pages oats");
  await logFood(page.request, oid, when.today, when.zone, oats);
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Search", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  const search = food.getByRole("searchbox", { name: "Search foods" });
  await search.blur();
  const chips = food.getByRole("group", { name: "Show" });
  // Scoped to its page: while a turn slides, two pages show at once.
  const recentRow = food.locator('[data-food-page="recent"]').getByRole("button", { name: /Add 150 g Fictional pages oats/ });

  // Opens on Recent. The other pages are out of view, so their rows aren't found.
  await expect(chips.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
  await expect(chips.getByRole("button", { name: "Recipes 0" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "My foods 1" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Groups 0" })).toBeVisible();
  await expect(recentRow).toBeVisible();
  await expect(food.getByRole("button", { name: /^New recipe/ })).toHaveCount(0);

  // Each chip turns to its page; New recipe and New food are the pages' first rows.
  await chips.getByRole("button", { name: /^Recipes/ }).click();
  await expect(food.getByRole("button", { name: /^New recipe/ })).toBeVisible();
  await expect(food.getByText("No recipes yet")).toBeVisible();
  await expect(recentRow).toHaveCount(0);
  await chips.getByRole("button", { name: /^My foods/ }).click();
  await expect(food.getByRole("button", { name: /^New food/ })).toBeVisible();
  await expect(food.getByRole("button", { name: "Edit Fictional pages oats" })).toBeVisible();

  // Recent → Groups is one step back round the carousel, and Groups → Recent one step on.
  await chips.getByRole("button", { name: /^Recent/ }).click();
  await expect(recentRow).toBeVisible();
  await chips.getByRole("button", { name: /^Groups/ }).click();
  await expect(food.getByText("No groups yet")).toBeVisible();
  await expect(chips.getByRole("button", { name: /^Groups/ })).toHaveAttribute("aria-pressed", "true");
  // Arrow keys on the pager wrap too: Groups → Recent → Groups.
  await food.locator(".pager .track").focus();
  await page.keyboard.press("ArrowRight");
  await expect(chips.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
  await expect(recentRow).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(chips.getByRole("button", { name: /^Groups/ })).toHaveAttribute("aria-pressed", "true");

  // The dots show where you are; the chips name the pages, so screen readers hear each name once.
  const dots = food.locator(".pager .dot");
  await expect(dots).toHaveCount(4);
  await expect(dots.first()).toHaveAttribute("aria-hidden", "true");
  // The chips share the row equally, whatever the counts, and keep a 44px hit.
  const widths = await chips.getByRole("button").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);
  for (const chip of await chips.getByRole("button").all()) {
    const box = await chip.boundingBox();
    expect(box && box.height >= 44).toBeTruthy();
  }

  // A search holds the page and looks only through it: on My foods it filters my foods, and the dots go.
  await chips.getByRole("button", { name: /^My foods/ }).click();
  const mineSearch = food.getByRole("searchbox", { name: "Search foods" });
  await expect(mineSearch).toHaveAttribute("placeholder", "Search my foods");
  await mineSearch.fill("pages");
  await expect(food.getByRole("button", { name: "Edit Fictional pages oats" })).toBeVisible();
  await expect(dots).toHaveCount(0);
  await mineSearch.fill("zzz");
  await expect(food.getByText("No match in my foods.")).toBeVisible();
  await mineSearch.fill("");
  await mineSearch.blur();

  await page.waitForFunction(() => document.querySelectorAll("[data-food-page][data-offscreen]").length === 3);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);
});
