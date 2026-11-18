import { expect, test, type Page } from "@playwright/test";

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function foodSheet(page: Page) {
  return page.getByRole("dialog").last();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the added tray steps aside while the search has the keyboard", async ({ page }) => {
  const oid = `e2e-session-tray-${Date.now()}-${test.info().project.name}`;
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
  const food = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: { name: "Fictional tray butter", nutrientBasis: "per_100", basis: "g", kcalPer100: 700, proteinPer100: 1, fatPer100: 80, carbsPer100: 1 },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);

  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  const search = foodSheet(page).getByRole("searchbox", { name: "Search foods" });
  await search.blur();
  await foodSheet(page).getByRole("button", { name: /My foods/ }).click();
  await foodSheet(page).getByRole("button", { name: /^Fictional tray butter/ }).click();
  await foodSheet(page).getByRole("button", { name: /^Add · \d+ kcal/ }).click();

  const tray = foodSheet(page).locator("[data-session]");
  await expect(tray).toBeVisible();
  await expect(tray).toContainText("1 added");

  // Typing a search: the tray hides so the results get the room above the keyboard.
  await search.focus();
  await expect(search).toBeFocused();
  await expect(tray).toBeHidden();
  await search.fill("Fictional");
  await expect(tray).toBeHidden();

  // Keyboard down: the tray and its Done are back.
  await search.blur();
  await expect(tray).toBeVisible();
  await expect(tray.getByRole("button", { name: "Done" })).toBeVisible();

  // Two added: Save as group and Save as recipe join Done. Their labels wrap on a phone, and
  // each keeps 8px above and below it inside the pill.
  await foodSheet(page).getByRole("button", { name: /^Fictional tray butter/ }).click();
  await foodSheet(page).getByRole("button", { name: /^Add · \d+ kcal/ }).click();
  await expect(tray).toContainText("2 added");
  const buttons = tray.locator(".btn");
  await expect(buttons).toHaveCount(3);
  const gaps = await buttons.evaluateAll((list) => list.map((button) => {
    const inset = parseFloat(getComputedStyle(button).getPropertyValue("--inset")) || 0;
    const box = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button);
    const text = range.getBoundingClientRect();
    return Math.min(text.top - (box.top + inset), box.bottom - inset - text.bottom);
  }));
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(7.5);
});
