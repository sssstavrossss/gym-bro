import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function ready(page: Page, oid: string) {
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
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("home, progress, pads, search, and recalculate preview on an iPhone", async ({ page }) => {
  const oid = `e2e-polish36-${Date.now()}-${test.info().project.name}`;
  await ready(page, oid);
  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const pad = await page.locator("main.today").evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  const safe = await page.locator("[data-safe-top]").evaluate((el) => parseFloat(getComputedStyle(el).height));
  expect(pad).toBeGreaterThanOrEqual(62);
  expect(safe).toBeGreaterThanOrEqual(62);
  const title = page.getByRole("heading", { name: "Today", exact: true });
  await expect(title).toHaveClass(/sr-only/);
  const titleBox = await title.boundingBox();
  expect(titleBox?.height ?? 0).toBeLessThanOrEqual(1);
  await expect(page.getByRole("status").filter({ hasText: "Time to recalculate your target" })).toHaveCount(0);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.getByRole("main", { name: "Today" }).getByRole("button", { name: "Recalculate", exact: true })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/progress");
  await expect(page.locator("[data-range-bar]")).toHaveCSS("position", "sticky");

  await page.goto("/today");
  await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
  const weight = page.getByRole("dialog", { name: "Log weight" });
  const field = weight.getByRole("textbox", { name: "Weight in kilograms" });
  await expect(field).toHaveAttribute("inputmode", "none");
  await expect(field).toBeFocused();
  const caret = await field.evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd, length: input.value.length }));
  expect(caret.start).toBe(caret.length);
  expect(caret.end).toBe(caret.length);
  await page.keyboard.type("70");
  await expect(field).toHaveValue("70");
  await weight.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Log your first food today" }).click();
  const food = page.getByRole("dialog", { name: "Add food" });
  const search = food.getByRole("searchbox", { name: "Search foods" });
  await search.focus();
  await expect(food.getByRole("heading", { name: "Add food" })).toBeHidden();
  await expect(food.getByRole("group", { name: "Show" })).toBeHidden();
  await food.locator(".list").dispatchEvent("wheel", { deltaY: 80 });
  await expect(search).not.toBeFocused();
  await food.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/profile");
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Recalculate" });
  await expect(sheet.locator("[data-recalc-preview]")).toBeVisible();
  await expect(sheet.locator("[data-derivation]")).toContainText(/Adaptive|Formula fallback/);
  await expect(sheet.getByRole("button", { name: "Accept" })).toBeVisible();
  await sheet.getByRole("button", { name: "Decline" }).click();
  await expect(sheet).toBeHidden();
});
