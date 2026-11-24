import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: "UTC" });

function sheet(page: Page) {
  return page.getByRole("dialog").last();
}

test("food in ounces: typed in oz, saved in grams, untouched amounts kept exactly", async ({ page }) => {
  const oid = `e2e-food-units-${Date.now()}-${test.info().project.name}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${today}`, { headers, data: { kg: 83.6, timeZone: "UTC" } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: "UTC",
    },
  })).ok()).toBeTruthy();
  const created = await page.request.post("/api/foods", {
    headers,
    data: { name: "Fictional oat bowl", nutrientBasis: "per_100", basis: "g", kcalPer100: 200, proteinPer100: 10, fatPer100: 5, carbsPer100: 30 },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const foodId = (await created.json()).id as string;
  const recipe = await page.request.post("/api/recipes", {
    headers,
    data: { name: "Fictional oat pot", portions: 2, finishedGrams: 450, ingredients: [{ foodId, amount: 150, unit: "g" }] },
  });
  expect(recipe.ok(), await recipe.text()).toBeTruthy();
  const recipeId = (await recipe.json()).id as string;

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/profile");

  // Settings: Food sits under Weight and Height and saves at once. It's a setting, not a target change.
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator("[data-food-note]")).toHaveText("Protein, fat, carbs and nutrients stay in grams.");
  await settings.getByRole("radiogroup", { name: "Food unit" }).getByRole("radio", { name: "ounces" }).click();
  await expect(settings.getByRole("radio", { name: "ounces" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await (await page.request.get("/api/profile", { headers })).json()).profile.foodUnit).toBe("oz");
  const history = await (await page.request.get("/api/profile/history", { headers })).json();
  expect(history.rows).toHaveLength(1);
  await page.keyboard.press("Escape");

  // The amount screen types ounces and shows the grams under the field.
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await sheet(page).getByRole("button", { name: /My foods/ }).click();
  await sheet(page).getByRole("button", { name: /^Fictional oat bowl/ }).click();
  await expect(sheet(page).getByRole("radio", { name: "oz", exact: true })).toBeChecked();
  await expect(sheet(page).getByRole("textbox", { name: "Amount in oz" })).toBeVisible();
  await sheet(page).getByRole("button", { name: "4 oz", exact: true }).click();
  await expect(sheet(page).locator("[data-metric-line]")).toHaveText("= 113 g");
  await sheet(page).getByRole("button", { name: /Add · 227 kcal/ }).click();
  await expect(page.locator("[data-session] button.frow").filter({ hasText: "Fictional oat bowl" })).toContainText("4 oz");
  await sheet(page).getByRole("button", { name: "Done" }).click();

  const logged = page.locator("main button.frow").filter({ hasText: "Fictional oat bowl" });
  await expect(logged).toContainText("4 oz");
  const entries = async () => (await (await page.request.get(`/api/log-entries?date=${today}`, { headers })).json()).entries as { amount: number; unit: string }[];
  expect((await entries())[0]).toMatchObject({ amount: 113.4, unit: "g" });

  // Editing shows the same ounces; a new amount is saved in grams.
  await logged.click();
  await expect(page.getByRole("dialog", { name: "Edit food" })).toBeVisible();
  await expect(sheet(page).getByRole("textbox", { name: "Amount in oz" })).toHaveValue("4");
  await sheet(page).getByRole("button", { name: "8 oz", exact: true }).click();
  await sheet(page).getByRole("button", { name: /Save · 454 kcal/ }).click();
  await expect(page.getByText(/Updated Fictional oat bowl · 454 kcal/)).toBeVisible();
  await expect(logged).toContainText("8 oz");
  expect((await entries())[0]).toMatchObject({ amount: 226.8, unit: "g" });

  // A recipe saved as 150 g shows 5.3 oz, and saving it untouched keeps 150 g (5.3 oz alone would be 150.25 g).
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await sheet(page).getByRole("button", { name: /Recipes/ }).click();
  await sheet(page).getByRole("button", { name: "Edit recipe Fictional oat pot" }).click();
  const edit = page.getByRole("dialog", { name: "Edit recipe" });
  await expect(edit.getByRole("textbox", { name: "Amount of Fictional oat bowl" })).toHaveValue("5.3");
  await expect(edit.getByRole("textbox", { name: "Finished weight in ounces, optional" })).toHaveValue("15.9");
  await edit.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(/Updated Fictional oat pot · [\d,]+ kcal per portion/)).toBeVisible();
  const saved = await (await page.request.get(`/api/recipes/${recipeId}`, { headers })).json();
  expect(saved.ingredients[0].amount).toBe(150);
  expect(saved.finishedGrams).toBe(450);
});
