import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Describe a meal runs on the rule model in E2e: it splits on commas and "and", reads a leading
// number, and takes the first food the search finds. The foods here have made-up names so the
// search finds only them.

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

async function setUp(request: APIRequestContext, oid: string, when: { zone: string; today: string }) {
  expect((await request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  for (const food of [
    { name: "Fictional zibble egg", kcalPer100: 150, proteinPer100: 13, fatPer100: 10, carbsPer100: 1, basis: "g", pieceQuantity: 60, pieceLabel: "egg" },
    { name: "Fictional wumpus bread", kcalPer100: 250, proteinPer100: 9, fatPer100: 3, carbsPer100: 45, basis: "g" },
  ]) {
    const response = await request.post("/api/foods", { headers: headers(oid), data: food });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
}

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

const meal = "2 zibble eggs, 80 g wumpus bread and mum's quibble";

function sheet(page: Page) {
  return page.getByRole("dialog", { name: "Add food" });
}

async function describeFromHome(page: Page) {
  const prompt = page.locator("main.today [data-food-prompt]");
  await prompt.getByRole("button", { name: "Describe a meal", exact: true }).click();
  await expect(sheet(page).getByRole("radio", { name: "Describe" })).toBeChecked();
  const box = sheet(page).getByRole("textbox", { name: "What you ate" });
  await expect(box).toBeFocused();
  await box.fill(meal);
  await sheet(page).getByRole("button", { name: "Find foods" }).click();
  await expect(sheet(page).getByRole("heading", { name: "2 of 3 found" })).toBeVisible();
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("describe a meal from Home, change an amount, add, and use it again", async ({ page }) => {
    const oid = `e2e-describe-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await setUp(page.request, oid, when);
    await sign(page, oid);
    await page.goto("/today");

    // An empty day: the prompt card carries the pill, three full-size doors.
    const prompt = page.locator("main.today [data-food-prompt]");
    await expect(prompt.getByText("Search, scan or describe a meal")).toBeVisible();
    const pill = prompt.locator("[data-add-pill]");
    for (const name of ["Add food", "Scan a barcode", "Describe a meal"]) {
      const box = await pill.getByRole("button", { name, exact: true }).boundingBox();
      expect(box && box.width >= 44 && box.height >= 44, name).toBeTruthy();
    }

    await describeFromHome(page);
    const found = sheet(page).locator('[data-described="found"]');
    await expect(found).toHaveCount(2);
    await expect(found.nth(0)).toContainText("Fictional zibble egg");
    await expect(found.nth(0)).toContainText("“2 zibble eggs”");
    await expect(found.nth(1)).toContainText("Fictional wumpus bread");
    await expect(sheet(page).locator('[data-described="missing"]')).toContainText("No match for “mum's quibble”");
    // 2 eggs = 120 g = 180 kcal, 80 g bread = 200 kcal. Nothing is logged yet.
    const add = sheet(page).getByRole("button", { name: "Add 2 foods · 380 kcal" });
    await expect(add).toBeVisible();
    expect((await (await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) })).json()).entries).toHaveLength(0);

    // A row opens the amount screen; Use brings the new amount back to the list.
    await found.nth(1).locator(".pick").click();
    await expect(sheet(page).getByRole("button", { name: "Use · 200 kcal" })).toBeVisible();
    const keypad = sheet(page).getByRole("group", { name: "Number keypad" });
    for (const key of ["1", "0", "0"]) await keypad.getByRole("button", { name: key, exact: true }).click();
    await sheet(page).getByRole("button", { name: "Use · 250 kcal" }).click();
    await expect(sheet(page).getByRole("button", { name: "Add 2 foods · 430 kcal" })).toBeVisible();

    // The check circle leaves a row out.
    await sheet(page).getByRole("button", { name: "Include Fictional zibble egg" }).click();
    await expect(sheet(page).getByRole("button", { name: "Add 1 food · 250 kcal" })).toBeVisible();
    await sheet(page).getByRole("button", { name: "Include Fictional zibble egg" }).click();
    await sheet(page).getByRole("button", { name: "Add 2 foods · 430 kcal" }).click();
    await expect(page.getByText("Added 2 foods · 430 kcal")).toBeVisible();

    const body = await (await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) })).json();
    const logged = body.entries.map((entry: { name: string; grams: number }) => `${entry.grams} g ${entry.name}`);
    expect(logged.sort()).toEqual(["100 g Fictional wumpus bread", "120 g Fictional zibble egg"]);

    // Next time it is on the recent list, with the amounts it was logged with.
    await sheet(page).getByRole("radio", { name: "Describe" }).click();
    const recent = sheet(page).getByRole("list", { name: "Recent descriptions" }).getByRole("button");
    await expect(recent).toHaveCount(1);
    await expect(recent).toContainText(meal);
    await expect(recent).toContainText("2 foods · 430 kcal · today");
    await recent.click();
    await expect(sheet(page).getByRole("heading", { name: "2 foods" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: "Add 2 foods · 430 kcal" })).toBeVisible();
  });

  test("a food with no match hands off to Search or Quick add", async ({ page }) => {
    const oid = `e2e-describe-miss-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await setUp(page.request, oid, when);
    await sign(page, oid);
    await page.goto("/today");

    await describeFromHome(page);
    const missing = sheet(page).locator('[data-described="missing"]');
    await missing.getByRole("button", { name: "Search" }).click();
    await expect(sheet(page).getByRole("radio", { name: "Search" })).toBeChecked();
    await expect(sheet(page).getByRole("searchbox", { name: "Search foods" })).toHaveValue("mum's quibble");

    // The list waits on the Describe tab.
    await sheet(page).getByRole("radio", { name: "Describe" }).click();
    await expect(sheet(page).getByRole("heading", { name: "2 of 3 found" })).toBeVisible();
    await missing.getByRole("button", { name: "Quick add" }).click();
    await expect(sheet(page).getByRole("radio", { name: "Quick Add" })).toBeChecked();
    await expect(sheet(page).getByRole("textbox", { name: "Name (optional)" })).toHaveValue("mum's quibble");

    // The words can be changed and found again.
    await sheet(page).getByRole("radio", { name: "Describe" }).click();
    await sheet(page).getByRole("button", { name: "Edit what you ate" }).click();
    const box = sheet(page).getByRole("textbox", { name: "What you ate" });
    await expect(box).toHaveValue(meal);
    await box.fill("80 g wumpus bread");
    await box.press("Enter");
    await expect(sheet(page).getByRole("heading", { name: "1 food" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: "Add 1 food · 200 kcal" })).toBeVisible();
  });
});

test("the tablet and desktop Foods card has the same pill", async ({ page }) => {
  const oid = `e2e-describe-wide-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when);
  await sign(page, oid);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/today");
  const pill = page.locator("main.today .logc [data-add-pill]");
  await expect(pill.getByRole("button")).toHaveCount(3);
  await pill.getByRole("button", { name: "Describe a meal", exact: true }).click();
  await expect(sheet(page).getByRole("radio", { name: "Describe" })).toBeChecked();
});
