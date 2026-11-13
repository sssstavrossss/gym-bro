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

async function createFood(request: APIRequestContext, oid: string, name: string, kcal: number, protein: number) {
  const response = await request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name,
      kcalPer100: kcal,
      proteinPer100: protein,
      fatPer100: 10,
      carbsPer100: 0,
      basis: "g",
      nutrientBasis: "per_100",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return body.id as string;
}

async function logFood(request: APIRequestContext, oid: string, date: string, zone: string, foodId: string, name: string, time: string) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${name}-${time}`,
      localDate: date,
      timeZone: zone,
      time,
      foodId,
      amount: 100,
      unit: "g",
      kcal: 1,
      protein: 1,
      fat: 1,
      carbs: 1,
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

test("create a recipe, see per-portion protein update, log it, and retire it", async ({ page }) => {
  const oid = `e2e-recipe-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await createFood(page.request, oid, "Fictional recipe chicken", 400, 100);

  await sign(page, oid);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await food.getByRole("searchbox", { name: "Search foods" }).blur();
  await food.getByRole("button", { name: /Recipes/ }).click();
  await food.getByRole("button", { name: "New recipe" }).first().click();

  const sheet = page.getByRole("dialog", { name: "New recipe" });
  await expect(sheet.getByText("Calories and macros are worked out from the foods.")).toBeVisible();
  await expect(sheet.getByLabel("Calories")).toHaveCount(0);
  await expect(sheet.getByLabel("Protein")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Add ingredient" }).click();
  await sheet.getByLabel("Search foods").fill("Fictional recipe chicken");
  await sheet.getByRole("button", { name: /Fictional recipe chicken/ }).click();
  await sheet.getByLabel("Amount of Fictional recipe chicken").fill("250");
  await sheet.getByRole("button", { name: "Add to recipe" }).click();
  await expect(sheet.getByText("250 g protein · 1000 kcal")).toBeVisible();
  await sheet.getByLabel("Portions").fill("5");
  await expect(sheet.locator("[data-recipe-portion]")).toHaveText("P 50 · F 5 · C 0");
  await sheet.getByLabel("Portions").fill("10");
  await expect(sheet.locator("[data-recipe-portion]")).toHaveText("P 25 · F 2.5 · C 0");
  await sheet.getByLabel("Portions").fill("5");
  await expect(sheet.locator("[data-recipe-portion]")).toHaveText("P 50 · F 5 · C 0");
  await sheet.getByLabel("Recipe name").fill("Chicken pot");
  await sheet.getByLabel("Finished weight in grams, optional").fill("500");

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
    await expect(sheet.locator("[data-recipe-portion]")).toHaveText("P 50 · F 5 · C 0");
    const save = sheet.getByRole("button", { name: "Save recipe" });
    const box = await save.boundingBox();
    expect(box && box.height >= 44 && box.width >= 44).toBeTruthy();
    await expectClean(page);
  }

  await sheet.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(/Saved “Chicken pot” · 50 g protein per portion/)).toBeVisible();

  const again = page.getByRole("dialog", { name: "Add food" });
  await again.getByRole("button", { name: "Log recipe Chicken pot" }).click();
  const logging = page.getByRole("dialog", { name: "Log Chicken pot" });
  await expect(logging.getByText("50 g protein in this log")).toBeVisible();
  await expect(logging.getByRole("radio", { name: "grams" })).toBeVisible();
  await logging.getByRole("button", { name: /Add · 200 kcal/ }).click();
  await expect(page.getByText(/Added 1 portion Chicken pot · 50 g protein/)).toBeVisible();

  await again.getByRole("button", { name: "Log recipe Chicken pot" }).click();
  const grams = page.getByRole("dialog", { name: "Log Chicken pot" });
  await grams.getByRole("radio", { name: "grams" }).click();
  await grams.getByLabel("Amount to log").fill("100");
  await expect(grams.getByText("50 g protein in this log")).toBeVisible();
  await grams.getByRole("button", { name: /Add · 200 kcal/ }).click();
  await expect(page.getByText(/Added 100 g Chicken pot · 50 g protein/)).toBeVisible();

  await again.getByRole("button", { name: "Delete recipe Chicken pot" }).click();
  await expect(page.getByText("Deleted Chicken pot · past logs kept")).toBeVisible();
  await expect(again.getByRole("button", { name: "Log recipe Chicken pot" })).toHaveCount(0);

  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const body = await listed.json();
  const pots = body.entries.filter((entry: { name: string }) => entry.name === "Chicken pot");
  expect(pots).toHaveLength(2);
  expect(pots.every((entry: { protein: number; source: string }) => entry.protein === 50 && entry.source === "recipe")).toBeTruthy();
  expect(pots.some((entry: { unit: string }) => entry.unit === "portion")).toBeTruthy();
  expect(pots.some((entry: { unit: string; grams: number }) => entry.unit === "g" && entry.grams === 100)).toBeTruthy();
  const recipes = await page.request.get("/api/recipes", { headers: headers(oid) });
  expect((await recipes.json()).recipes).toHaveLength(0);
});

test("save as recipe from a selection of foods", async ({ page }) => {
  const oid = `e2e-recipe-select-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  const chicken = await createFood(page.request, oid, "Fictional select chicken", 400, 100);
  const rice = await createFood(page.request, oid, "Fictional select rice", 200, 50);
  await logFood(page.request, oid, when.today, when.zone, chicken, "Fictional select chicken", "08:15");
  await logFood(page.request, oid, when.today, when.zone, rice, "Fictional select rice", "08:20");
  await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: "quick-side",
      localDate: when.today,
      timeZone: when.zone,
      time: "08:25",
      name: "Fictional quick side",
      kcal: 40,
      protein: 1,
      fat: 1,
      carbs: 1,
    },
  });

  await sign(page, oid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.locator("button.frow").filter({ hasText: "Fictional select chicken" }).click();
  await page.locator("button.frow").filter({ hasText: "Fictional quick side" }).click({ modifiers: ["Shift"] });
  const saveAs = page.getByRole("button", { name: "Save as recipe" });
  const box = await saveAs.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBeTruthy();
  await saveAs.click();

  const sheet = page.getByRole("dialog", { name: "Save as recipe" });
  await expect(sheet.getByText("Quick add isn't included.")).toBeVisible();
  await expect(sheet.getByText("Fictional select chicken")).toBeVisible();
  await expect(sheet.getByText("Fictional select rice")).toBeVisible();
  await expect(sheet.getByText("Fictional quick side")).toHaveCount(0);
  await sheet.getByLabel("Recipe name").fill("Plate");
  await sheet.getByLabel("Portions").fill("3");
  await expect(sheet.locator("[data-recipe-portion]")).toHaveText("P 50 · F 6.7 · C 0");
  await expectClean(page);
  await sheet.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByText(/Saved “Plate” · 50 g protein per portion/)).toBeVisible();

  const recipes = await page.request.get("/api/recipes", { headers: headers(oid) });
  const body = await recipes.json();
  expect(body.recipes).toHaveLength(1);
  expect(body.recipes[0].protein).toBe(150);
  expect(body.recipes[0].perPortion.protein).toBe(50);
  expect(body.recipes[0].ingredients).toHaveLength(2);
});
