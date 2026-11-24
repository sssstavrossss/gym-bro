import { expect, test, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog").last();
}

const MICROS = [
  "monoFat", "polyFat", "transFat", "omega3", "epaDha", "omega6", "cholesterol", "addedSugars", "starch", "sodium",
  "vitaminA", "vitaminD", "vitaminE", "vitaminC", "thiamin", "riboflavin", "niacin", "vitaminB6", "folate", "vitaminB12",
  "calcium", "iron", "zinc", "magnesium", "potassium", "phosphorus", "selenium", "iodine", "copper",
];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("food search rows show a ring for how many micronutrients the food has", async ({ page }) => {
  const oid = `e2e-micro-ring-${Date.now()}-${test.info().project.name}`;
  const base = { nutrientBasis: "per_100", basis: "g", kcalPer100: 400, proteinPer100: 10, fatPer100: 10, carbsPer100: 60, saturatedFatPer100: 2, sugarsPer100: 5, fiberPer100: 3 };
  const foods = [
    { name: "Fictional ring label bar", nutrients: {} },
    { name: "Fictional ring fortified bar", nutrients: { vitaminC: 30, iron: 2, calcium: 120 } },
    { name: "Fictional ring complete bar", nutrients: Object.fromEntries(MICROS.map((key) => [key, 1])) },
  ];
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
  for (const food of foods) {
    const made = await page.request.post("/api/foods", { headers: headers(oid), data: { ...base, ...food } });
    expect(made.ok(), await made.text()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  const search = foodSheet(page).getByRole("searchbox", { name: "Search foods" });
  await search.fill("Fictional ring");

  const ring = (name: string) => foodSheet(page).locator(".rrow", { hasText: name }).getByRole("img", { name: /^Micronutrients:/ });
  await expect(ring("label bar")).toHaveAccessibleName("Micronutrients: none (0 of 29)");
  await expect(ring("fortified bar")).toHaveAccessibleName("Micronutrients: few (3 of 29)");
  await expect(ring("complete bar")).toHaveAccessibleName("Micronutrients: all (29 of 29)");

  // The ring sits at the right end of the row, centred on its height. One read, so a sheet still settling can't skew it.
  const place = await foodSheet(page).locator('[data-food-page="recent"] .rrow', { hasText: "label bar" }).evaluate((row) => {
    const r = row.getBoundingClientRect();
    const b = row.querySelector(".micro")!.getBoundingClientRect();
    return { rightGap: r.right - b.right, centre: b.top + b.height / 2 - (r.top + r.height / 2) };
  });
  expect(place.rightGap).toBeGreaterThanOrEqual(-0.5);
  expect(place.rightGap).toBeLessThan(24);
  expect(Math.abs(place.centre)).toBeLessThanOrEqual(1);

  // Ingredient search in a recipe shows the same ring.
  await search.fill("");
  await search.blur();
  await foodSheet(page).getByRole("button", { name: /Recipes/ }).click();
  await foodSheet(page).getByRole("button", { name: "New recipe" }).click();
  const recipe = page.getByRole("dialog", { name: "New recipe" });
  await recipe.getByRole("button", { name: "Add ingredient" }).click();
  await recipe.getByRole("searchbox", { name: "Search foods" }).fill("Fictional ring");
  await expect(ring("fortified bar")).toHaveAccessibleName("Micronutrients: few (3 of 29)");
  await expect(ring("complete bar")).toHaveAccessibleName("Micronutrients: all (29 of 29)");
});
