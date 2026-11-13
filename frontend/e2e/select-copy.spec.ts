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

async function logFood(request: APIRequestContext, oid: string, date: string, zone: string, name: string, time: string, kcal: number) {
  const response = await request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${name}-${time}`,
      localDate: date,
      timeZone: zone,
      name,
      time,
      kcal,
      protein: 10,
      fat: 5,
      carbs: 20,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test("select, copy to today, and hover-delete with undo", async ({ page }) => {
  const oid = `e2e-copy-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await logFood(page.request, oid, when.today, when.zone, "Fictional oats", "08:15", 200);
  await logFood(page.request, oid, when.today, when.zone, "Fictional broth", "12:30", 50);
  await sign(page, oid);
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();

  const select = page.getByRole("button", { name: "Select", exact: true });
  await expect(select).toBeVisible();
  const selectBox = await select.boundingBox();
  expect(selectBox && selectBox.width >= 44 && selectBox.height >= 44).toBeTruthy();

  const complete = page.getByRole("checkbox", { name: /Fasting day/ });
  await complete.click();
  await expect(complete).toBeChecked();

  await select.click();
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toContainText("0 · 0");
  await page.locator("button.frow").filter({ hasText: "Fictional oats" }).click();
  await page.locator("button.frow").filter({ hasText: "Fictional broth" }).click({ modifiers: ["Shift"] });
  await expect(page.getByRole("toolbar", { name: "Selected entries" })).toContainText("2 ·");

  await page.getByRole("button", { name: "Copy to…" }).click();
  const sheet = page.getByRole("dialog", { name: "Copy to" });
  await expect(sheet.getByRole("heading", { name: /Copy 2 items to/ })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /^Today/ })).toBeChecked();
  await expect(sheet.getByRole("radio", { name: /Tomorrow/ })).toHaveCount(0);
  const picker = sheet.getByLabel("Pick another date");
  await expect(picker).toHaveAttribute("max", when.today);
  const min = await picker.getAttribute("min");
  expect(min && min <= when.today).toBeTruthy();
  expect(min && min > when.today).toBeFalsy();

  await sheet.getByRole("button", { name: "Copy to today" }).click();
  await expect(page.getByText(/Copied 2 items · 250 kcal to today/)).toBeVisible();
  await expect(complete).toBeChecked();
  await expect(page.locator("button.frow").filter({ hasText: "Fictional oats" })).toHaveCount(2);

  const listed = await page.request.get(`/api/log-entries?date=${when.today}`, { headers: headers(oid) });
  const body = await listed.json();
  expect(body.entries).toHaveLength(4);
  const oats = body.entries.filter((entry: { name: string }) => entry.name === "Fictional oats");
  expect(oats).toHaveLength(2);
  expect(new Set(oats.map((entry: { id: string }) => entry.id)).size).toBe(2);
  expect(new Set(oats.map((entry: { idempotencyKey: string }) => entry.idempotencyKey)).size).toBe(2);
  expect(oats.every((entry: { time: string; kcal: number; groupId: string | null }) => entry.time === "08:15" && entry.kcal === 200 && entry.groupId == null)).toBeTruthy();

  const status = await page.request.get(`/api/day-status?date=${when.today}&timeZone=${encodeURIComponent(when.zone)}`, { headers: headers(oid) });
  const day = await status.json();
  expect(day.fasting).toBe(true);

  const line = page.locator(".line").filter({ hasText: "Fictional broth" }).first();
  await line.hover();
  const remove = line.getByRole("button", { name: "Delete Fictional broth" });
  const removeBox = await remove.boundingBox();
  expect(removeBox && removeBox.width >= 44 && removeBox.height >= 44).toBeTruthy();
  await remove.click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.locator("button.frow").filter({ hasText: "Fictional broth" })).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("button.frow").filter({ hasText: "Fictional broth" })).toHaveCount(2);
  await expect(complete).toBeChecked();

  await page.locator("button.frow").filter({ hasText: "Fictional oats" }).first().click();
  await expect(page.getByRole("button", { name: "Copy to another day", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
});
