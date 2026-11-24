import { expect, test, type Page } from "@playwright/test";

// Import a recipe runs on stand-ins in E2e: every link reads as the same test page ("Fictional test
// stew & rice", 4 portions, three ingredients), a link ending in /no-recipe as a page without one,
// and the rule model splits one ingredient a line and takes the first food the search finds.

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

function sheet(page: Page) {
  return page.getByRole("dialog", { name: "New recipe" });
}

async function start(page: Page, prefix: string) {
  const oid = `e2e-${prefix}-${Date.now()}-${test.info().project.name}`;
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
  for (const food of [
    { name: "Fictional stew chicken", kcalPer100: 110, proteinPer100: 23, fatPer100: 2, carbsPer100: 0, basis: "g" },
    { name: "Fictional stew rice", kcalPer100: 130, proteinPer100: 3, fatPer100: 0, carbsPer100: 28, basis: "g" },
    { name: "Fictional stew spice", kcalPer100: 300, proteinPer100: 10, fatPer100: 10, carbsPer100: 40, basis: "g" },
  ]) {
    const response = await page.request.post("/api/foods", { headers: headers(oid), data: food });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await page.keyboard.press("n");
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).blur();
  await food.getByRole("button", { name: /Recipes/ }).click();
  await food.getByRole("button", { name: "New recipe" }).first().click();
  await expect(sheet(page).getByRole("heading", { name: "New recipe" })).toBeVisible();
  return oid;
}

test("a link fills New recipe with its name, portions and the matched ingredients", async ({ page }) => {
  await start(page, "import-link");
  // A door in the top bar and one under Add ingredient while the recipe is empty.
  const doors = sheet(page).getByRole("button", { name: "Import a recipe" });
  await expect(doors).toHaveCount(2);
  const bar = (await doors.first().boundingBox())!;
  expect(bar.width).toBeGreaterThanOrEqual(44);
  expect(bar.height).toBeGreaterThanOrEqual(44);
  await doors.last().click();

  await expect(sheet(page).getByRole("heading", { name: "Import a recipe" })).toBeVisible();
  const find = sheet(page).getByRole("button", { name: "Find ingredients" });
  await expect(find).toBeDisabled();
  await sheet(page).getByRole("textbox", { name: "Recipe link or ingredients" }).fill("https://www.example.com/oppskrift/stew");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/recipes/import"));
  await find.click();
  expect((await sent).postDataJSON()).toEqual({ url: "https://www.example.com/oppskrift/stew" });

  await expect(sheet(page).getByText("Fictional test stew & rice")).toBeVisible();
  await expect(sheet(page).getByText("example.com · 4 portions")).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "2 of 3 found" })).toBeVisible();
  await expect(sheet(page).getByText("No match for “1 klype fictional spice”")).toBeVisible();
  await expect(sheet(page).getByText("Pick a food, or leave it out.")).toBeVisible();
  // 400 g chicken = 440 kcal; 200 g rice = 260 kcal.
  await sheet(page).getByRole("button", { name: "Use 2 ingredients · 700 kcal" }).click();

  await expect(sheet(page).getByRole("heading", { name: "New recipe" })).toBeVisible();
  await expect(sheet(page).getByLabel("Recipe name")).toHaveValue("Fictional test stew & rice");
  await expect(sheet(page).getByLabel("Portions")).toHaveValue("4");
  await expect(sheet(page).getByText("Imported from example.com. 1 ingredient wasn't added. Check the amounts before you save.")).toBeVisible();
  await expect(sheet(page).locator("[data-recipe-total]")).toContainText("700 kcal");
  // With ingredients in, only the top-bar door is left.
  await expect(sheet(page).getByRole("button", { name: "Import a recipe" })).toHaveCount(1);

  const saved = page.waitForResponse((response) => response.url().endsWith("/api/recipes") && response.request().method() === "POST");
  await sheet(page).getByRole("button", { name: "Save recipe" }).click();
  const recipe = await (await saved).json();
  expect(recipe.name).toBe("Fictional test stew & rice");
  expect(recipe.portions).toBe(4);
  expect(recipe.ingredients).toHaveLength(2);
});

test("pasted ingredients can be changed, searched and left out before they go in", async ({ page }) => {
  await start(page, "import-text");
  await sheet(page).getByRole("button", { name: "Import a recipe" }).first().click();
  await sheet(page).getByRole("textbox", { name: "Recipe link or ingredients" }).fill("300 g fictional stew chicken\n100 g fictional stew rice\n1 pinch of mystery");
  await sheet(page).getByRole("button", { name: "Find ingredients" }).click();
  await expect(sheet(page).getByRole("heading", { name: "2 of 3 found" })).toBeVisible();
  // Pasted text has no page: no name card.
  await expect(sheet(page).getByText("Pasted ingredients")).toHaveCount(0);

  // Change the chicken's amount: the amount screen's button says Use and comes back here.
  await sheet(page).getByRole("button", { name: /^Fictional stew chicken/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("500");
  await sheet(page).getByRole("button", { name: "Use · 550 kcal" }).click();
  await expect(sheet(page).getByRole("heading", { name: "2 of 3 found" })).toBeVisible();

  // Search for the one that didn't match.
  await sheet(page).getByRole("button", { name: "Search" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Find ingredient" })).toBeVisible();
  await sheet(page).getByLabel("Search foods").fill("Fictional stew spice");
  await sheet(page).getByRole("button", { name: /Fictional stew spice/ }).click();
  await sheet(page).getByLabel("Amount in g").fill("10");
  await sheet(page).getByRole("button", { name: "Use · 30 kcal" }).click();
  await expect(sheet(page).getByRole("heading", { name: "3 ingredients" })).toBeVisible();

  // Leave the rice out.
  await sheet(page).getByRole("button", { name: "Include Fictional stew rice" }).click();
  // 500 g chicken = 550 kcal; 10 g spice = 30 kcal.
  await sheet(page).getByRole("button", { name: "Use 2 ingredients · 580 kcal" }).click();

  await expect(sheet(page).getByLabel("Recipe name")).toHaveValue("");
  await expect(sheet(page).getByText("Imported 2 ingredients. 1 ingredient wasn't added. Check the amounts before you save.")).toBeVisible();
  await expect(sheet(page).locator("[data-recipe-total]")).toContainText("580 kcal");
});

test("a page without a recipe says so and keeps the link to fix", async ({ page }) => {
  await start(page, "import-none");
  await sheet(page).getByRole("button", { name: "Import a recipe" }).first().click();
  const box = sheet(page).getByRole("textbox", { name: "Recipe link or ingredients" });
  await box.fill("https://example.com/no-recipe");
  await sheet(page).getByRole("button", { name: "Find ingredients" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Couldn't find a recipe on that page. Paste the ingredients instead.");
  await expect(box).toHaveValue("https://example.com/no-recipe");

  // Back returns to the empty form.
  await sheet(page).getByRole("button", { name: "Back" }).click();
  await expect(sheet(page).getByRole("heading", { name: "New recipe" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Import a recipe" })).toHaveCount(2);
});
