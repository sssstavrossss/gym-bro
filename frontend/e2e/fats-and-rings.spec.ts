import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Gym Bro Test", "Content-Type": "application/json" };
}

async function today(page: Page) {
  return page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
}

/**
 * 200 g of a rich test food: 24 g saturated fat, 300 mg cholesterol, 240 mg vitamin C
 * (over 100% for a man), and 50 mg iron (above the 40 mg upper limit). A quick add with no
 * panel makes every coverage note read "from 1 of 2 foods".
 */
async function seed(request: APIRequestContext, oid: string, date: string) {
  const zone = "Europe/Oslo";
  expect((await request.put(`/api/weigh-ins/${date}`, { headers: headers(oid), data: { kg: 90, timeZone: zone } })).ok()).toBeTruthy();
  expect((await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  })).ok()).toBeTruthy();
  const food = await request.post("/api/foods", {
    headers: headers(oid),
    data: {
      name: "Test liver", brand: null, barcode: null, basis: "g", nutrientBasis: "per_100",
      kcalPer100: 200, proteinPer100: 20, fatPer100: 30, carbsPer100: 2,
      saturatedFatPer100: 12, sugarsPer100: null, fiberPer100: null, saltPer100: null,
      servingQuantity: null, servingLabel: null,
      nutrients: { monoFat: 10, polyFat: 3, cholesterol: 150, vitaminC: 120, iron: 25 },
    },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  const id = (await food.json()).id as string;
  expect((await request.post("/api/log-entries", {
    headers: headers(oid),
    data: { idempotencyKey: `${oid}-liver`, localDate: date, timeZone: zone, time: "08:00", foodId: id, amount: 200, unit: "g", kcal: 1, protein: 1, fat: 1, carbs: 1 },
  })).ok()).toBeTruthy();
  expect((await request.post("/api/log-entries", {
    headers: headers(oid),
    data: { idempotencyKey: `${oid}-bar`, localDate: date, timeZone: zone, time: "12:00", name: "Loose bar", kcal: 300, protein: 10, fat: 10, carbs: 40 },
  })).ok()).toBeTruthy();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Oslo" });

async function showPanel(card: Locator, id: string) {
  await expect(card.locator(`[data-panel='${id}']`)).toHaveCount(1);
  const index = await card.locator("[data-panel]").evaluateAll((panels, want) => panels.findIndex((panel) => panel.getAttribute("data-panel") === want), id);
  expect(index).toBeGreaterThan(0);
  await card.locator("button.dot").nth(index).click();
}

async function signIn(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

test("lower fat limits show on the Fats card", async ({ page }) => {
  const oid = `e2e-fats-${Date.now()}`;
  await seed(page.request, oid, await today(page));
  await signIn(page, oid);

  await page.goto("/today");
  const card = page.locator("[data-nutrient-card]");
  await showPanel(card, "fats");
  const fats = card.locator("[data-panel='fats']");
  await expect(fats.locator("[data-fat-total]")).toHaveText("70 g");
  // 60 g of fat, broken down into 50 g; the quick add's 10 g is not broken down either.
  await expect(fats.locator("[data-fat-part='rest'] .num")).toHaveText("20 g");
  await expect(fats.locator(".note")).toHaveText("from 1 of 2 foods");
  await expect(fats.locator("[data-saturated-limit]")).toContainText("≤ 10% of kcal");
  await expect(fats.locator("[data-fat-row='cholesterol']")).toHaveText(/^Cholesterol\s*300 mg$/);
  await expect(fats.locator("[data-fat-limits]")).toHaveCount(0);

  await page.goto("/profile");
  await page.locator("[data-cog]").click();
  const setting = page.locator("[data-fat-limits-setting]");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/profile/settings") && response.ok()),
    setting.getByRole("radio", { name: "Lower" }).click(),
  ]);
  await expect(setting.getByRole("radio", { name: "Lower" })).toHaveAttribute("aria-checked", "true");
  await expect(setting).toContainText("≤ 7% of calories");
  await page.getByRole("button", { name: "Close" }).click();

  // Saved on the account, so a fresh load keeps it.
  await page.goto("/today");
  await showPanel(card, "fats");
  await expect(fats.locator("[data-fat-limits]")).toHaveText("Lower limits");
  const limit = fats.locator("[data-saturated-limit]");
  await expect(limit).toContainText("≤ 7% of kcal");
  await expect(limit.locator(".overtag")).toHaveText(/^\+[\d.]+ over$/);
  await expect(limit.locator(".bar.over")).toHaveCount(1);
  const cholesterol = fats.locator("[data-fat-row='cholesterol']");
  await expect(cholesterol.locator(".end")).toHaveText("300/ 200 mg");
  await expect(cholesterol.locator(".overval")).toHaveText("300");
  await expect(cholesterol.locator(".sr-only")).toHaveText("over the limit");
  const box = await card.boundingBox();
  expect(Math.round(box!.height)).toBe(214);
  const fits = await fats.evaluate((panel) => {
    const bottom = panel.lastElementChild!.getBoundingClientRect().bottom;
    const dots = panel.closest("[data-nutrient-card]")!.querySelector(".strip")!.getBoundingClientRect().top;
    const right = panel.getBoundingClientRect().right;
    const overflow = [...panel.querySelectorAll("*")]
      .filter((node) => !node.classList.contains("sr-only") && node.getBoundingClientRect().right > right + 0.5)
      .map((node) => `${node.className} ${Math.round(node.getBoundingClientRect().right)}/${Math.round(right)}`);
    // At most at the top of the dot strip: the strip's own 12px keep it clear of the dots.
    return { below: bottom <= dots + 0.5 ? "" : `${bottom} > ${dots}`, overflow };
  });
  expect(fits).toEqual({ below: "", overflow: [] });
});

test("vitamin and mineral rings open a nutrient sheet", async ({ page }) => {
  const oid = `e2e-rings-${Date.now()}`;
  await seed(page.request, oid, await today(page));
  await signIn(page, oid);

  await page.goto("/today");
  const card = page.locator("[data-nutrient-card]");
  await showPanel(card, "vitamins");
  const vitamins = card.locator("[data-panel='vitamins']");
  await expect(vitamins.locator("[data-ring]")).toHaveCount(10);
  await expect(vitamins.locator(".note")).toHaveText("from 1 of 2 foods");
  const vitaminC = vitamins.locator("[data-ring='vitaminC']");
  await expect(vitaminC).toHaveClass(/\bhit\b/);
  await expect(vitaminC).toHaveAttribute("aria-label", "Vitamin C 240 mg, 218% of the daily reference. Details");
  await expect(vitaminC.locator(".pc")).toHaveText("218");
  // The week's average (this day only) draws the inner ring.
  await expect(vitaminC.locator("[data-week-ring]")).toHaveCount(1);

  await showPanel(card, "minerals");
  const minerals = card.locator("[data-panel='minerals']");
  await expect(minerals.locator("[data-ring]")).toHaveCount(9);
  const iron = minerals.locator("[data-ring='iron']");
  await expect(iron).toHaveClass(/\bover\b/);
  await expect(iron).toHaveAttribute("aria-label", /above the upper limit/);
  const rows = await minerals.locator("[data-ring]").evaluateAll((rings) => [...new Set(rings.map((ring) => Math.round(ring.getBoundingClientRect().top)))].length);
  expect(rows).toBe(2);

  await iron.click();
  const sheet = page.getByRole("dialog", { name: "Iron" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-reference]")).toHaveText("reference 9 mg · upper limit 40 mg");
  await expect(sheet.locator("[data-amount]")).toHaveText("50 mg");
  await expect(sheet.locator(".overtag")).toHaveText("Above 40 mg");
  await expect(sheet.locator("[data-week]")).toHaveText("7-day avg 50 mg");
  await expect(sheet.locator("[data-day-source]")).toHaveText([/Test liver\s*50 mg/]);
  await expect(sheet.locator("[data-missing]")).toHaveText("No Iron data: Loose bar");
  await expect(sheet.locator("[data-good-source]")).toHaveText([/Test liver\s*25 mg \/ 100 g/]);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  // A nutrient no food has: no sources, and an honest empty line.
  await minerals.locator("[data-ring='iodine']").click();
  const iodine = page.getByRole("dialog", { name: "Iodine" });
  await expect(iodine.locator("[data-day-source]")).toHaveCount(0);
  await expect(iodine).toContainText("Nothing logged this day has Iodine.");
  await expect(iodine).toContainText("None of the foods you've logged list Iodine yet.");
});
