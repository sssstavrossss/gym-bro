import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The macros card on the recipe screens, and the one cog that picks its pages everywhere.

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

async function setUp(request: APIRequestContext, oid: string, date: string, zone: string) {
  const weigh = await request.put(`/api/weigh-ins/${date}`, { headers: headers(oid), data: { kg: 83.6, timeZone: zone } });
  expect(weigh.ok(), await weigh.text()).toBeTruthy();
  const profile = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose", rateKgPerWeek: 0.5,
      goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2, fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const food = await request.post("/api/foods", {
    headers: headers(oid),
    data: { name: "Fictional card chicken", kcalPer100: 400, proteinPer100: 100, fatPer100: 10, carbsPer100: 0, basis: "g", nutrientBasis: "per_100" },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  const foodId = (await food.json()).id as string;
  // 300 g: 1,200 kcal, P 300, F 30. Two portions of 600 kcal.
  const recipe = await request.post("/api/recipes", {
    headers: headers(oid),
    data: { name: "Card pot", portions: 2, finishedGrams: null, ingredients: [{ foodId, amount: 300, unit: "g" }] },
  });
  expect(recipe.ok(), await recipe.text()).toBeTruthy();
}

// A phone, so the screens show the app keypad.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openRecipes(page: Page) {
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).blur();
  await food.getByRole("button", { name: /Recipes/ }).click();
  return food;
}

test("log recipe is an amount screen with the day's card, and its cog opens over the sheet", async ({ page }) => {
  const oid = `e2e-recipe-card-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  await sign(page, oid);
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();

  const food = await openRecipes(page);
  await food.getByRole("button", { name: "Log recipe Card pot" }).click();
  const logging = page.getByRole("dialog", { name: "Log Card pot" });
  await expect(logging.getByRole("heading", { name: "Card pot" })).toBeVisible();
  await expect(logging.locator("[data-recipe-serving]")).toHaveText("2 portions · 600 kcal each");
  // No finished weight, so no portion/grams switch.
  await expect(logging.getByRole("radio")).toHaveCount(0);
  const card = logging.locator(".preview");
  await expect(card.getByText("Today after adding")).toBeVisible();
  await expect(card.locator("[data-macro='kcal'] [data-adding]")).toHaveText("+600");
  await expect(card.locator("[data-macro='p'] [data-adding]")).toHaveText("+150");
  await expect(card.locator("button.dot")).toHaveCount(5);
  // It all fits: the note and the Add button are on screen without scrolling.
  await expect(logging.getByText("Later edits to the recipe don't change this entry.")).toBeInViewport();
  await expect(logging.getByRole("button", { name: "Add · 600 kcal" })).toBeInViewport();

  await logging.getByRole("button", { name: "2", exact: true }).click();
  await expect(logging.getByRole("button", { name: "Add · 1,200 kcal" })).toBeVisible();

  // The cog opens the pages sheet over Log recipe, which keeps what was typed.
  await card.getByRole("button", { name: "Choose macros card pages" }).click();
  const pages = page.getByRole("dialog", { name: "Macros card pages" });
  await expect(pages).toBeVisible();
  await expect(logging).toBeVisible();
  await pages.getByRole("switch", { name: /^Vitamins/ }).click();
  await page.keyboard.press("Escape");
  await expect(pages).toBeHidden();
  await expect(logging).toBeVisible();
  await expect(card.locator("button.dot")).toHaveCount(4);
  await expect(logging.getByLabel("Amount to log")).toHaveValue("2");

  // Edit opens the editor; closing it comes back to logging.
  await logging.getByRole("button", { name: "Edit recipe" }).click();
  const edit = page.getByRole("dialog", { name: "Edit recipe" });
  const perCard = edit.locator("[data-recipe-card]");
  await expect(perCard.getByText("Per portion")).toBeVisible();
  await expect(perCard.locator("[data-macro='kcal'] [data-num]")).toHaveText("600");
  // One portion against the day's targets: bars, no "left" or "to go".
  await expect(perCard.locator("[data-macro] .bar").first()).toBeVisible();
  await expect(perCard.locator("[data-left]")).toHaveCount(0);
  // The hidden page is hidden here too.
  await expect(perCard.locator("button.dot")).toHaveCount(4);
  await expect(edit.locator("[data-recipe-total]")).toHaveText("1,200 kcal · P 300 · F 30 · C 0");
  await expect(edit.locator("[data-recipe-sum]")).toHaveCount(0);

  // Typing an ingredient's amount: the keypad line carries the per-portion figures.
  await edit.getByLabel("Amount of Fictional card chicken").click();
  const pad = edit.locator("[data-recipe-pad]");
  await pad.getByRole("button", { name: "1", exact: true }).click();
  await pad.getByRole("button", { name: "5", exact: true }).click();
  await pad.getByRole("button", { name: "0", exact: true }).click();
  await expect(pad).toContainText("Per portion · 300 kcal · P 75 · F 8 · C 0");
  await pad.getByRole("button", { name: "Done" }).click();

  await edit.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Log Card pot" })).toBeVisible();

  // Home's card follows the same choice.
  await page.goto("/today");
  await expect(page.locator("[data-nutrient-card] .dot")).toHaveCount(4);
});

test("the cog on Add food's amount screen keeps the food open", async ({ page }) => {
  const oid = `e2e-food-cog-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  await sign(page, oid);
  await page.goto("/log");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).fill("Fictional card chicken");
  await food.getByRole("button", { name: /Fictional card chicken/ }).first().click();
  await food.getByLabel("Amount in g").fill("250");
  const cog = food.locator(".preview").getByRole("button", { name: "Choose macros card pages" });
  await cog.focus();
  await page.keyboard.press("Enter");
  const pages = page.getByRole("dialog", { name: "Macros card pages" });
  await expect(pages).toBeVisible();
  await expect(pages.getByText(/every macros card/)).toBeVisible();
  await pages.getByRole("button", { name: "Close" }).click();
  await expect(pages).toBeHidden();
  await expect(food.getByLabel("Amount in g")).toHaveValue("250");
  // Focus goes back to the cog it came from.
  await expect(cog).toBeFocused();
});

test("a new recipe starts at one portion, and portions can't be left empty", async ({ page }) => {
  const oid = `e2e-recipe-one-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await setUp(page.request, oid, when.today, when.zone);
  await sign(page, oid);
  await page.goto("/log");
  const food = await openRecipes(page);
  await food.getByRole("button", { name: "New recipe" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New recipe" });
  await expect(sheet.getByLabel("Portions")).toHaveValue("1");
  await sheet.getByLabel("Portions").click();
  await sheet.locator("[data-recipe-pad]").getByRole("button", { name: "Delete digit" }).click();
  await expect(sheet.getByLabel("Portions")).toHaveValue("");
  // Save stays tappable (aria-disabled) so a tap can say what's missing.
  await sheet.getByRole("button", { name: "Save recipe" }).click({ force: true });
  await expect(sheet.getByText("Enter portions above 0 and at most 1,000.")).toBeVisible();
});
