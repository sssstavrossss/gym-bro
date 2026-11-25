import { expect, test, type Locator, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const PAGES = ["Weight", "Calories", "Protein", "Fat", "Carbs", "Fibre", "Saturated fat", "Sodium", "Burn"];

/** Eight pages are too many for 44px dots on a phone, so the dot strip only shows where you are. Step with Next panel. */
async function showPage(progress: Locator, title: string) {
  const heading = progress.locator("[data-progress-title]");
  let at = PAGES.indexOf(await heading.innerText());
  while (PAGES[at] !== title) {
    at = (at + 1) % PAGES.length;
    await progress.getByRole("button", { name: "Next panel" }).last().click();
    await expect(heading).toHaveText(PAGES[at]);
    // A tap during the snap is lost, so wait for the track to stop.
    await progress.locator(".track").evaluate((track) => new Promise<void>((done) => {
      let last = -1;
      let still = 0;
      const tick = () => {
        still = track.scrollLeft === last ? still + 1 : 0;
        last = track.scrollLeft;
        if (still >= 6) done();
        else requestAnimationFrame(tick);
      };
      tick();
    }));
  }
}

/** Today: 200 g of a food with 20 g saturated fat and 2 g salt per 100 g, and nothing else. */
async function setup(page: Page) {
  const oid = `e2e-progress-limits-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  const food = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: { name: "Fictional cheese crackers", kcalPer100: 480, proteinPer100: 10, fatPer100: 30, carbsPer100: 40, saturatedFatPer100: 20, saltPer100: 2 },
  });
  expect(food.ok(), await food.text()).toBeTruthy();
  const logged = await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: { idempotencyKey: `${oid}-crackers`, localDate: when.today, timeZone: when.zone, time: "12:00", foodId: (await food.json()).id, amount: 200, unit: "g" },
  });
  expect(logged.ok(), await logged.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    // Start on Weight once; a reload keeps the page the test picked.
    if (sessionStorage.getItem("gymbro-e2e-kept")) return;
    sessionStorage.setItem("gymbro-e2e-kept", "1");
    localStorage.setItem("gymbro-home-range", "7d");
    localStorage.setItem("gymbro-home-progress-page", "0");
  }, oid);
  return oid;
}

test("saturated fat and sodium pages draw a limit and hatch what goes over it", async ({ page }) => {
  await page.goto("/");
  const oid = await setup(page);

  const body = await (await page.request.get("/api/progress?range=7d", { headers: headers(oid) })).json();
  const today = body.days[body.days.length - 1];
  expect(today.saturatedFat).toBe(40);
  // Salt only: 4 g salt is 1,600 mg sodium.
  expect(today.sodiumMg).toBe(1600);

  await page.goto("/today");
  const progress = page.getByRole("region", { name: "Progress", exact: true });
  const cell = (pageName: string, label: string) => progress.locator(`[data-page='${pageName}'] .cell`).filter({ hasText: label });

  await showPage(progress, "Saturated fat");
  const saturated = progress.locator("[data-page='saturatedFat']");
  await expect(saturated.getByRole("img", { name: "Saturated fat chart" })).toBeVisible();
  await expect(saturated.locator("[data-target-label]")).toHaveText(/^limit \d+ g$/);
  await expect(saturated.locator("[data-bar]")).toHaveCount(1);
  await expect(saturated.locator("[data-over]")).toHaveCount(1);
  await expect(cell("saturatedFat", "Average").locator("[data-num]")).toHaveText("40 g");
  await expect(cell("saturatedFat", "Average")).toContainText(/limit \d+ g/);
  await expect(cell("saturatedFat", "Under limit").locator("[data-num]")).toHaveText("0 days");
  await expect(cell("saturatedFat", "Under limit")).toContainText("of 1 logged");

  await showPage(progress, "Sodium");
  const sodium = progress.locator("[data-page='sodium']");
  await expect(sodium.locator("[data-target-label]")).toHaveText("limit 2,300 mg");
  await expect(sodium.locator("[data-over]")).toHaveCount(0);
  await expect(cell("sodium", "Average").locator("[data-num]")).toHaveText("1,600 mg");
  await expect(cell("sodium", "Average")).toContainText("4.0 g salt");
  await expect(cell("sodium", "Under limit").locator("[data-num]")).toHaveText("1 day");

  // The card reopens on the last page.
  await page.reload();
  await expect(progress.locator("[data-progress-title]")).toHaveText("Sodium");

  // Strict sodium on Profile: a setting on its own, so the targets and their history stay.
  await page.goto("/profile");
  const setting = page.locator("[data-sodium-setting]");
  const caption = setting.locator("[data-sodium-caption]");
  await expect(caption).toHaveText("≤ 2,300 mg a day · 5.8 g salt");
  const history = async () => (await (await page.request.get("/api/profile/history", { headers: headers(oid) })).json()).rows.length;
  const historyBefore = await history();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/profile/settings") && response.ok()),
    setting.getByRole("radio", { name: "Strict" }).click(),
  ]);
  await expect(caption).toHaveText("≤ 1,500 mg a day · 3.8 g salt");
  await expect(page.locator("[data-saturated-setting]").getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
  expect(await history()).toBe(historyBefore);

  // Saved on the account: the Sodium page and the Carbs card both use 1,500 mg, so today's 1,600 mg is over.
  await page.goto("/today");
  await expect(progress.locator("[data-progress-title]")).toHaveText("Sodium");
  await expect(sodium.locator("[data-target-label]")).toHaveText("limit 1,500 mg");
  await expect(sodium.locator("[data-over]")).toHaveCount(1);
  await expect(cell("sodium", "Under limit").locator("[data-num]")).toHaveText("0 days");
  const card = page.locator("[data-nutrient-card]");
  const index = await card.locator("[data-panel]").evaluateAll((panels) => panels.findIndex((panel) => panel.getAttribute("data-panel") === "carbs"));
  await card.locator("button.dot").nth(index).click();
  const carbs = card.locator("[data-panel='carbs']");
  await expect(carbs.locator("[data-sodium-limit]")).toHaveText("Strict sodium");
  await expect(carbs.locator("[data-carb-limit='sodium']")).toContainText("1600 / 1500 mg");
  await expect(carbs.locator("[data-carb-limit='sodium']")).toContainText("+100 over");
});
