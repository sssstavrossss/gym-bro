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

/** Four weigh-ins over the last week, the latest two days ago, so today is after the last weigh-in. */
async function setup(page: Page) {
  const oid = `e2e-weight-trend-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  for (const [back, kg] of [[7, 84.2], [6, 84.0], [4, 83.9], [2, 83.6]] as const) {
    const saved = await page.request.put(`/api/weigh-ins/${shift(when.today, -back)}`, { headers: headers(oid), data: { kg, timeZone: when.zone } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
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
    try {
      localStorage.setItem("gymbro-home-range", "7d");
      localStorage.setItem("gymbro-home-progress-page", "0");
    } catch { /* defaults still show the weight page */ }
  }, oid);
  return { oid, ...when };
}

test("the weight trend has a band, goes dotted after the last weigh-in, and waits for a rate", async ({ page }) => {
  await page.goto("/");
  const when = await setup(page);

  const body = await (await page.request.get("/api/progress?range=7d", { headers: headers(when.oid) })).json();
  const byDate = new Map<string, { trendMeasured: boolean; trendBandKg: number | null }>(body.days.map((day: { date: string }) => [day.date, day]));
  expect(byDate.get(shift(when.today, -4))?.trendMeasured).toBe(true);
  expect(byDate.get(when.today)?.trendMeasured).toBe(false);
  expect(byDate.get(when.today)?.trendBandKg).toBeGreaterThan(byDate.get(shift(when.today, -2))?.trendBandKg ?? 0);
  expect(body.weight.bandKg).toBeGreaterThan(0);
  expect(body.weight.rateKgPerWeek).toBeNull();

  await page.goto("/today");
  const weight = page.locator(".home-progress [data-page='weight']");
  await expect(weight.locator("[data-band]")).toHaveCount(1);
  await expect(weight.locator("[data-band-outer]")).toHaveCount(1);
  await expect(weight.locator("[data-trend-solid]")).toHaveCount(1);
  await expect(weight.locator("[data-trend-dashed]")).toHaveCount(1);

  const cell = (label: string) => weight.locator(".cell").filter({ hasText: label });
  await expect(cell("Trend")).toContainText(/±0\.\d · latest 83\.6/);
  await expect(cell("Rate").locator("[data-num]")).toHaveText("–");
  await expect(cell("Rate")).toContainText("needs 2 weeks");
});
