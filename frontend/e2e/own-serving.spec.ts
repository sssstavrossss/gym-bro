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

function foodSheet(page: Page) {
  return page.getByRole("dialog").last();
}

async function openAdd(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
}

test("add a private serving, log with it, and keep the old gram snapshot", async ({ page }) => {
  const oid = `e2e-serving-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  const bread = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name: "Fictional rye bread",
      nutrientBasis: "per_100",
      basis: "g",
      kcalPer100: 200,
      proteinPer100: 8,
      fatPer100: 2,
      carbsPer100: 36,
    },
  });
  expect(bread.ok(), await bread.text()).toBeTruthy();
  const breadId = (await bread.json()).id as string;
  const bar = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name: "Fictional serving bar",
      nutrientBasis: "per_serving",
      kcalPer100: 80,
      proteinPer100: 10,
    },
  });
  expect(bar.ok(), await bar.text()).toBeTruthy();

  await sign(page, oid);
  await page.goto("/today");
  await openAdd(page);
  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
  await foodSheet(page).getByRole("button", { name: /^Fictional serving bar/ }).click();
  await expect(foodSheet(page).getByRole("radio", { name: /^serving/ })).toBeVisible();
  await expect(foodSheet(page).getByRole("button", { name: "Serving", exact: true })).toHaveCount(0);
  await foodSheet(page).getByRole("button", { name: "Back", exact: true }).click();

  await foodSheet(page).getByRole("button", { name: /^Fictional rye bread/ }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "Fictional rye bread" })).toBeVisible();
  await expect(foodSheet(page).getByRole("radio", { name: "g", exact: true })).toBeVisible();
  const addServing = foodSheet(page).getByRole("button", { name: "Serving", exact: true });
  await expect(addServing).toBeVisible();
  await addServing.click();
  await expect(foodSheet(page).getByText("Private — only you see your servings.")).toBeVisible();
  await foodSheet(page).getByRole("textbox", { name: "Serving name" }).fill("slice");
  await foodSheet(page).getByRole("textbox", { name: "Grams in one serving" }).fill("35");
  await foodSheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved 1 slice = 35 g/)).toBeVisible();

  const slice = foodSheet(page).getByRole("radio", { name: "1 slice = 35 g" });
  await expect(slice).toBeChecked();
  await expect(foodSheet(page).getByText("= 35 g · 1 slice = 35 g")).toBeVisible();
  await expect(foodSheet(page).getByRole("button", { name: /Add · 70 kcal/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => item.id))).toEqual([]);
  await page.screenshot({ path: "/opt/cursor/artifacts/own-serving.png", fullPage: true });

  await foodSheet(page).getByRole("button", { name: /Add · 70 kcal/ }).click();
  await expect(page.getByText(/Added 1 slice Fictional rye bread · 70 kcal/)).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Done" }).click();
  const logged = page.locator("button.frow").filter({ hasText: "Fictional rye bread" });
  await expect(logged).toContainText("1 slice");
  await expect(logged).toContainText("70");

  const detail = await page.request.get(`/api/foods/${breadId}`, { headers: headers(oid) });
  const servingId = (await detail.json()).servings[0].id as string;
  const edited = await page.request.put(`/api/foods/${breadId}/servings/${servingId}`, {
    headers: headers(oid),
    data: { name: "slice", grams: 50 },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();

  await logged.click();
  await expect(page.getByRole("dialog", { name: "Edit food" })).toBeVisible();
  await expect(foodSheet(page).getByRole("radio", { name: "1 slice = 35 g" })).toBeChecked();
  await expect(foodSheet(page).getByRole("button", { name: "Serving", exact: true })).toHaveCount(0);
  await foodSheet(page).getByRole("button", { name: "2 slices" }).click();
  await expect(foodSheet(page).getByRole("button", { name: /Save · 140 kcal/ })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: /Save · 140 kcal/ }).click();
  await expect(page.getByText(/Updated Fictional rye bread · 140 kcal/)).toBeVisible();

  const day = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const entry = (await day.json()).entries.find((row: { name: string }) => row.name === "Fictional rye bread");
  expect(entry.unit).toBe("slice");
  expect(entry.amount).toBe(2);
  expect(entry.grams).toBe(70);
  expect(entry.kcal).toBe(140);
});
