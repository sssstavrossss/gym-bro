import { expect, test, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

async function setUp(page: Page, oid: string) {
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    return { zone, today: format.format(new Date()) };
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
  const food = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: { name: "Fictional rye bread", nutrientBasis: "per_100", basis: "g", kcalPer100: 250, proteinPer100: 9, fatPer100: 3, carbsPer100: 45 },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  return { ...when, foodId: (await food.json()).id as string };
}

async function openAddFood(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  await expect(page.getByRole("heading", { name: "Add food" })).toBeVisible();
  return foodSheet(page).getByRole("searchbox", { name: "Search foods" });
}

async function addRyeOffline(page: Page) {
  const search = await openAddFood(page);
  await expect(search).toHaveAttribute("placeholder", "Search your foods");
  await expect(foodSheet(page).locator("[data-offline-search]")).toContainText("Searching the full food list needs a connection.");
  await search.fill("rye");
  await foodSheet(page).getByRole("button", { name: /^Fictional rye bread/ }).click();
  await expect(foodSheet(page).locator("[data-offline-note]")).toContainText("This saves on your phone");
  await foodSheet(page).getByRole("button", { name: /^Add · \d+ kcal/ }).click();
  await expect(page.locator("[data-session] button.frow").filter({ hasText: "Fictional rye bread" })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
}

test("offline: log from kept foods, see what waits, and it sends once back", async ({ page, context }) => {
  const oid = `e2e-offline-${Date.now()}-${test.info().project.name}`;
  await page.setViewportSize({ width: 390, height: 844 });
  const when = await setUp(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  // Online once, so My foods is kept on the phone.
  await openAddFood(page);
  await expect(foodSheet(page).getByRole("button", { name: /My foods · 1/ })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("[data-offline-line]")).toHaveCount(0);

  await context.setOffline(true);
  const line = page.locator("[data-offline-line]");
  await expect(line).toContainText("Offline");
  await line.click();
  const sheet = page.getByRole("dialog", { name: "You're offline" });
  await expect(sheet).toContainText("Gym Bro keeps working on this phone");
  await expect(sheet).toContainText("Nothing waiting to send");
  await expect(sheet).toContainText("Needs a connection");
  await sheet.getByRole("button", { name: "Close" }).click();

  await addRyeOffline(page);
  const row = page.locator("main button.frow").filter({ hasText: "Fictional rye bread" });
  await expect(row.locator('[data-queued="waiting"]')).toContainText("waiting");
  await line.click();
  await expect(sheet).toContainText("1 food waiting to send");
  await expect(sheet).toContainText("Macros already count them.");
  await sheet.getByRole("button", { name: "Close" }).click();

  // An edit offline saves on the phone too.
  await row.click();
  await expect(page.getByRole("dialog", { name: "Edit food" })).toBeVisible();
  await expect(foodSheet(page).locator("[data-offline-note]")).toContainText("Offline. This saves on your phone and sends when you're back online.");
  await foodSheet(page).getByRole("button", { name: /^Save ·/ }).click();
  await expect(foodSheet(page)).toBeHidden();

  await context.setOffline(false);
  await expect(page.getByText("Back online. 1 food sent.")).toBeVisible();
  await expect(line).toHaveCount(0);
  await expect(row.locator("[data-queued]")).toHaveCount(0);
  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const body = await listed.json();
  expect(body.entries).toHaveLength(1);
  expect(body.entries[0]).toMatchObject({ name: "Fictional rye bread", foodId: when.foodId });
});

test("offline: an add the server refuses shows couldn't send and can be deleted", async ({ page, context }) => {
  const oid = `e2e-refused-${Date.now()}-${test.info().project.name}`;
  await page.setViewportSize({ width: 390, height: 844 });
  const when = await setUp(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("main", { name: "Today" })).toBeVisible();
  await openAddFood(page);
  await expect(foodSheet(page).getByRole("button", { name: /My foods · 1/ })).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();

  await context.setOffline(true);
  await addRyeOffline(page);
  // The food goes while the phone is offline (deleted on another device).
  expect((await page.request.delete(`/api/foods/${when.foodId}`, { headers: headers(oid) })).ok()).toBeTruthy();
  await context.setOffline(false);

  await expect(page.getByText(/1 food couldn't send/)).toBeVisible();
  const row = page.locator("main button.frow").filter({ hasText: "Fictional rye bread" });
  await expect(row.locator('[data-queued="failed"]')).toContainText("couldn't send");
  await expect(row).not.toContainText("kcal");
  await row.click();
  const note = foodSheet(page).locator("[data-offline-note]");
  await expect(note).toContainText("Couldn't send:");
  await expect(note).toContainText("Save keeps it as a quick add.");
  await foodSheet(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  expect((await listed.json()).entries).toHaveLength(0);
});
