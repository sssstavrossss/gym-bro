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
      fatPer100: 2,
      carbsPer100: 10,
      basis: "g",
      nutrientBasis: "per_100",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return body.id as string;
}

async function logFood(request: APIRequestContext, oid: string, date: string, zone: string, foodId: string, name: string, time: string, amount: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${name}-${time}`,
      localDate: date,
      timeZone: zone,
      time,
      foodId,
      amount,
      unit: "g",
      kcal: 1,
      protein: 1,
      fat: 1,
      carbs: 1,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return body.id as string;
}

test("save a group from a selection, expand it, and re-add it on today", async ({ page }) => {
  const oid = `e2e-group-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  const oats = await createFood(page.request, oid, "Fictional group oats", 200, 20);
  const broth = await createFood(page.request, oid, "Fictional group broth", 50, 5);
  const bar = await createFood(page.request, oid, "Fictional group bar", 300, 20);
  const originalOats = await logFood(page.request, oid, when.today, when.zone, oats, "Fictional group oats", "08:15", 100);
  const originalBroth = await logFood(page.request, oid, when.today, when.zone, broth, "Fictional group broth", "12:30", 100);
  await logFood(page.request, oid, when.today, when.zone, bar, "Fictional group bar", "18:45", 50);

  await sign(page, oid);
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
  const complete = page.getByRole("checkbox", { name: /Fasting day/ });
  await complete.click();
  await expect(complete).toBeChecked();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.locator("button.frow").filter({ hasText: "Fictional group oats" }).click();
  await page.locator("button.frow").filter({ hasText: "Fictional group bar" }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toContainText("3 selected");

  const saveAs = page.getByRole("button", { name: "Save as group" });
  const saveBox = await saveAs.boundingBox();
  expect(saveBox && saveBox.width >= 44 && saveBox.height >= 44).toBeTruthy();
  await saveAs.click();

  const naming = page.getByRole("dialog", { name: "Save as group" });
  await expect(naming.getByRole("heading", { name: "Save as group" })).toBeVisible();
  await naming.getByLabel("Group name").fill("Usual breakfast");
  await naming.getByRole("button", { name: /Save group · 3 items/ }).click();
  await expect(page.getByText(/Saved “Usual breakfast” · 3 items/)).toBeVisible();

  await page.getByRole("button", { name: "Add food", exact: true }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  await expect(food.getByText("Saved groups")).toBeVisible();
  await expect(food.getByRole("button", { name: /Usual breakfast 3 items/ })).toBeVisible();
  const remove = food.getByRole("button", { name: "Delete group Usual breakfast" });
  const removeBox = await remove.boundingBox();
  expect(removeBox && removeBox.width >= 44 && removeBox.height >= 44).toBeTruthy();
  await food.getByRole("button", { expanded: false, name: /Usual breakfast/ }).click();
  await expect(food.locator(".gi").filter({ hasText: "Fictional group broth" })).toBeVisible();
  await expect(food.locator(".gi").filter({ hasText: "Fictional group bar" })).toBeVisible();

  const revised = await page.request.put(`/api/foods/${oats}`, {
    headers: headers(oid),
    data: {
      name: "Fictional group oats",
      kcalPer100: 80,
      proteinPer100: 8,
      fatPer100: 2,
      carbsPer100: 10,
      basis: "g",
      nutrientBasis: "per_100",
    },
  });
  expect(revised.ok(), await revised.text()).toBeTruthy();
  const retired = await page.request.delete(`/api/foods/${bar}`, { headers: headers(oid) });
  expect(retired.status()).toBe(204);

  const add = food.getByRole("button", { name: "Add group Usual breakfast" });
  const addBox = await add.boundingBox();
  expect(addBox && addBox.width >= 44 && addBox.height >= 44).toBeTruthy();
  await add.click();
  await expect(page.getByText(/Skipped Fictional group bar/)).toBeVisible();
  await expect(complete).toBeChecked();

  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const body = await listed.json();
  expect(body.entries).toHaveLength(5);
  const groups = await page.request.get("/api/groups", { headers: headers(oid) });
  const groupId = (await groups.json()).groups[0].id as string;
  const fresh = body.entries.filter((entry: { id: string }) => entry.id !== originalOats && entry.id !== originalBroth && entry.foodId !== bar);
  const addedOats = fresh.find((entry: { foodId: string }) => entry.foodId === oats);
  const addedBroth = fresh.find((entry: { foodId: string }) => entry.foodId === broth);
  expect(addedOats.kcal).toBe(80);
  expect(addedOats.protein).toBe(8);
  expect(addedOats.groupId).toBe(groupId);
  expect(addedBroth.kcal).toBe(50);
  expect(addedBroth.groupId).toBe(groupId);
  expect(addedOats.time).toBe(addedBroth.time);
  expect(addedOats.id).not.toBe(originalOats);
  expect(addedOats.idempotencyKey).not.toBe(addedBroth.idempotencyKey);
  const kept = body.entries.find((entry: { id: string }) => entry.id === originalOats);
  expect(kept.kcal).toBe(200);
  expect(kept.groupId).toBeNull();
  expect(body.entries.filter((entry: { foodId: string }) => entry.foodId === bar)).toHaveLength(1);

  const status = await page.request.get(`/api/day-status?date=${when.today}&timeZone=${encodeURIComponent(when.zone)}`, { headers: headers(oid) });
  const day = await status.json();
  expect(day.fasting).toBe(true);
});
