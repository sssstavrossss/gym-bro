import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function shift(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function setup(page: Page, name: string) {
  const oid = `e2e-${name}-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 84, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    try { localStorage.setItem("gymbro-home-week-open", "0"); } catch { /* default is closed */ }
  }, oid);
  return { oid, ...when };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

async function quickAdd(page: Page, name: string, kcal: number) {
  const sheet = foodSheet(page);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("searchbox", { name: "Search foods" }).blur();
  await sheet.getByRole("radio", { name: "Quick Add" }).click();
  await sheet.getByRole("textbox", { name: "Name (optional)", exact: true }).fill(name);
  // On a phone the numbers go in through the sheet's own keypad.
  for (const [field, value] of [["Calories", String(kcal)], ["Protein", "20"], ["Fat", "10"], ["Carbs", "40"]]) {
    await sheet.getByRole("button", { name: field, exact: true }).click();
    for (const digit of value) await sheet.getByRole("group", { name: "Number keypad" }).getByRole("button", { name: digit, exact: true }).click();
  }
}

/** The Calories page of the Home Progress card, whichever page is showing. */
function loggedDays(page: Page) {
  return page.locator(".home-progress [data-page='kcal'] .cell").filter({ hasText: "Logged" }).locator("[data-num]");
}

test("Home's charts follow a food added today, without a reload", async ({ page }) => {
  await setup(page, "home-refresh");
  await page.goto("/today");
  await expect(loggedDays(page)).toHaveText("0 days");

  await page.getByRole("button", { name: /^Log your first food today/ }).click();
  await quickAdd(page, "Fictional refresh bar", 600);
  await foodSheet(page).getByRole("button", { name: /^Add/ }).last().click();
  await expect(page.getByText(/Added Fictional refresh bar/)).toBeVisible();
  await foodSheet(page).getByRole("button", { name: "Close", exact: true }).click();

  await expect(loggedDays(page)).toHaveText("1 day");
});

test("a later day can be picked and planned: food needs a time and stays out of today", async ({ page }) => {
  const when = await setup(page, "planned");
  const tomorrow = shift(when.today, 1);
  await page.goto("/today");
  const week = page.getByRole("group", { name: "This week" });
  const number = Number(tomorrow.slice(8));
  const tomorrowButton = week.getByRole("button", { name: new RegExp(`^\\S+, \\w+ ${number}, nothing planned`) });
  await expect(week.getByRole("button", { name: /, today, selected$/ })).toBeVisible();
  // On a Sunday, tomorrow is on next week's page.
  if (!(await tomorrowButton.count())) await page.getByRole("button", { name: "Next week" }).click();
  await expect(tomorrowButton).toBeEnabled();
  await tomorrowButton.click();
  await expect(page.getByRole("heading", { level: 1, name: "Tomorrow" })).toBeVisible();
  await page.getByRole("button", { name: /^Plan food for this day/ }).click();
  await quickAdd(page, "Fictional planned bowl", 700);
  const sheet = foodSheet(page);
  // A planned day has no "now": the add waits for a time.
  await expect(sheet.getByRole("button", { name: "Pick a time to add" })).toBeVisible();
  await sheet.getByLabel(/Change time/).fill("12:30");
  await sheet.getByRole("button", { name: /^Add to .* at 12:30/ }).click();
  await expect(page.getByText(/Added Fictional planned bowl/)).toBeVisible();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByRole("heading", { name: /^Foods tomorrow, / })).toBeVisible();
  await expect(page.locator("main button.frow").filter({ hasText: "Fictional planned bowl" })).toBeVisible();
  await expect(week.getByRole("button", { name: new RegExp(`^\\S+, \\w+ ${number}, planned, selected`) })).toBeVisible();

  const saved = await page.request.get(`/api/log-entries?date=${tomorrow}`, { headers: headers(when.oid) });
  const body = await saved.json();
  expect(body.entries).toHaveLength(1);
  expect(body.entries[0].time).toBe("12:30");

  // A plan is not eaten: Progress still shows nothing logged.
  await expect(loggedDays(page)).toHaveText("0 days");

  // The Log opens the planned day too, with no fasting toggle until the day comes.
  await page.goto(`/log/${tomorrow}`);
  await expect(page.locator("main button.frow").filter({ hasText: "Fictional planned bowl" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Fasting day/ })).toHaveCount(0);
});
