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
  await foodSheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await expect(foodSheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
}

async function expectClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, JSON.stringify(serious.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.slice(0, 2).map((node) => node.html) })))).toEqual([]);
}

test("create, save from quick add, search my food, and keep past entries", async ({ page }) => {
  const oid = `e2e-custom-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.goto("/today");
  await openAdd(page);

  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
  await expect(foodSheet(page).getByText("No foods of your own yet")).toBeVisible();
  await expect(foodSheet(page).getByText("Only you see them")).toBeVisible();
  await expectClean(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/custom-foods-empty.png", fullPage: true });

  await foodSheet(page).getByRole("button", { name: "Create a food" }).click();
  await expect(foodSheet(page).getByRole("heading", { name: "New food" })).toBeVisible();
  await foodSheet(page).getByRole("radio", { name: "Per serving" }).click();
  await foodSheet(page).getByRole("textbox", { name: "Name", exact: true }).fill("Fictional home shake");
  await foodSheet(page).getByPlaceholder("e.g. Northbar").fill("Northbar");
  await foodSheet(page).getByRole("textbox", { name: /Calories/ }).fill("100");
  await foodSheet(page).getByRole("textbox", { name: /Protein/ }).fill("1");
  await foodSheet(page).getByRole("textbox", { name: /Fat/ }).fill("1");
  await foodSheet(page).getByRole("textbox", { name: /Carbs/ }).fill("1");
  await expect(foodSheet(page).getByText(/you can still save/)).toBeVisible();
  await expectClean(page);
  await page.screenshot({ path: "/opt/cursor/artifacts/custom-food-editor.png", fullPage: true });
  await foodSheet(page).getByRole("button", { name: "Save food" }).click();

  await expect(foodSheet(page).getByRole("heading", { name: "Fictional home shake" })).toBeVisible();
  await expect(foodSheet(page).getByText("my food")).toBeVisible();
  await expect(foodSheet(page).getByText(/Northbar/)).toBeVisible();
  await expect(foodSheet(page).getByRole("radio", { name: /^serving/ })).toBeVisible();
  await expect(foodSheet(page).getByRole("radio", { name: /^g/ })).toHaveCount(0);
  await expect(foodSheet(page).getByRole("button", { name: /Add · 100 kcal/ })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/custom-food-serving-only.png", fullPage: true });
  await foodSheet(page).getByRole("button", { name: /Add · 100 kcal/ }).click();
  await expect(page.getByText(/Added 1 serving Fictional home shake · 100 kcal/)).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const logged = page.locator("button.frow").filter({ hasText: "Fictional home shake" });
  await expect(logged).toContainText("100");
  await expect(logged).toContainText("1 serving");

  await openAdd(page);
  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
  await foodSheet(page).getByRole("button", { name: "Edit Fictional home shake" }).click();
  await expect(foodSheet(page).getByText("Past entries keep the values they were logged with.")).toBeVisible();
  await foodSheet(page).getByRole("textbox", { name: /Calories/ }).fill("240");
  await foodSheet(page).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/past entries unchanged/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(logged).toContainText("100");
  await expect(logged).not.toContainText("240");

  await openAdd(page);
  await foodSheet(page).getByRole("radio", { name: "Quick Add" }).click();
  await foodSheet(page).getByLabel("Name (optional)").fill("Fictional quick oat bar");
  await foodSheet(page).getByLabel("Also save as my food").check();
  await foodSheet(page).getByLabel("Calories").fill("180");
  await foodSheet(page).getByLabel("Protein").fill("20");
  await foodSheet(page).getByRole("button", { name: /Add · 180 kcal/ }).click();
  await expect(page.getByText(/saved to My foods/)).toBeVisible();
  await foodSheet(page).getByRole("searchbox", { name: "Search foods" }).fill("quick oat");
  const found = foodSheet(page).getByRole("button", { name: /Fictional quick oat bar/ });
  await expect(found).toBeVisible();
  await expect(found).toContainText("my food");
  await page.screenshot({ path: "/opt/cursor/artifacts/custom-food-search.png", fullPage: true });
  await expectClean(page);
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
