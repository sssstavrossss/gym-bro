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

function sheet(page: Page) {
  return page.getByRole("dialog", { name: /^(Add food|Edit food)$/ });
}

async function openFood(page: Page, width: number) {
  await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
  if (width >= 1024) {
    await page.locator("aside").getByRole("button", { name: /Add food/ }).click();
  } else {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  }
  await sheet(page).getByRole("searchbox", { name: "Search foods" }).blur();
  await expect(sheet(page).getByRole("heading", { name: "Add food" })).toBeVisible();
}

test("the viewport still allows pinch zoom", async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no/i);
  expect(content ?? "").not.toMatch(/maximum-scale\s*=\s*1(?:\.0+)?\b/i);
});

test.describe("phone inputs", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("search, quick add, and profile fields are at least 16px", async ({ page }) => {
    const oid = `e2e-zoom-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await putWeighIn(page.request, oid, when.today, when.zone);
    await putProfile(page.request, oid, when.zone);
    await sign(page, oid);
    await page.goto("/today");
    await openFood(page, 390);

    const search = sheet(page).getByRole("searchbox", { name: "Search foods" });
    expect(await search.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);

    await sheet(page).getByRole("radio", { name: "Quick Add" }).click();
    const name = sheet(page).getByRole("textbox", { name: "Name (optional)" });
    expect(await name.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);

    await page.evaluate(() => { document.documentElement.style.fontSize = "53px"; });
    expect(await name.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(16);

    await page.goto("/profile");
    const year = page.getByRole("textbox", { name: "Birth year" });
    await expect(year).toBeVisible();
    expect(await year.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    const zone = page.getByRole("textbox", { name: "Time zone" });
    expect(await zone.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test("the keypad replaces a number after leaving the field", async ({ page }) => {
    const oid = `e2e-keys-${Date.now()}-${test.info().project.name}`;
    const when = await clock(page);
    await putWeighIn(page.request, oid, when.today, when.zone);
    await putProfile(page.request, oid, when.zone);
    await sign(page, oid);
    await page.goto("/today");
    await openFood(page, 390);
    await sheet(page).getByRole("radio", { name: "Quick Add" }).click();

    const calories = sheet(page).getByRole("button", { name: "Calories" });
    const protein = sheet(page).getByRole("button", { name: "Protein" });
    const key = (label: string) => sheet(page).getByRole("button", { name: label, exact: true });

    await calories.click();
    await key("2").click();
    await key("5").click();
    await expect(calories.locator("[data-num]")).toHaveText("25");
    await protein.click();
    await expect(calories.locator("[data-num]")).toHaveText("25");
    await calories.click();
    await key("3").click();
    await key("0").click();
    await expect(calories.locator("[data-num]")).toHaveText("30");

    await protein.click();
    await calories.click();
    await key("Delete digit").click();
    await expect(calories.locator("[data-num]")).toHaveText("3");
    await protein.click();
    await calories.click();
    await key(".").click();
    await key("5").click();
    await expect(calories.locator("[data-num]")).toHaveText("0.5");
  });
});

test("desktop type stays under 16px and a refocused number is replaced", async ({ page }) => {
  const oid = `e2e-desk-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, when.zone);
  await putProfile(page.request, oid, when.zone);
  await sign(page, oid);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today");
  await openFood(page, 1440);

  const search = sheet(page).getByRole("searchbox", { name: "Search foods" });
  expect(await search.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeLessThan(16);

  await sheet(page).getByRole("radio", { name: "Quick Add" }).click();
  const calories = sheet(page).getByRole("textbox", { name: "Calories", exact: true });
  await calories.click();
  await page.keyboard.type("25");
  await expect(calories).toHaveValue("25");
  await sheet(page).getByRole("textbox", { name: "Protein", exact: true }).click();
  await expect(calories).toHaveValue("25");
  await calories.click();
  await page.keyboard.type("30");
  await expect(calories).toHaveValue("30");

  await calories.blur();
  await calories.click();
  await page.keyboard.type("12.5");
  await expect(calories).toHaveValue("12.5");
  expect(await calories.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(16);
});
