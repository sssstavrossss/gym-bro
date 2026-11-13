import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the week strip is its own padded band", async ({ page }) => {
  const oid = `e2e-week-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 84, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/api/log-entries", {
    headers: headers(oid),
    data: {
      idempotencyKey: `${oid}-oats`, localDate: when.today, timeZone: when.zone, time: "08:15",
      name: "Fictional week oats", kcal: 400, protein: 20, fat: 8, carbs: 40,
    },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    document.documentElement.classList.add("demo-statusbar");
  }, oid);

  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const week = page.getByRole("group", { name: "This week" });
  await expect(week).toBeVisible();
  const top = await week.evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(54);
  await expectBand(week, "rgb(32, 35, 42)", "rgb(142, 147, 160)");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-week-home.png" });
  }

  await page.goto("/log");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  const logWeek = page.getByRole("group", { name: "This week" });
  await expectBand(logWeek, "rgb(32, 35, 42)", "rgb(142, 147, 160)");
  expect(await logWeek.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(54);
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-week-log.png" });
  }

  await page.evaluate(() => { document.documentElement.dataset.theme = "midnight"; });
  await expectBand(logWeek, "rgb(27, 34, 51)", "rgb(139, 151, 176)");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/iphone40-week-midnight.png" });
  }
});

async function expectBand(week: ReturnType<Page["getByRole"]>, surface: string, muted: string) {
  await expect(week).toHaveCSS("padding-top", "6px");
  await expect(week).toHaveCSS("padding-bottom", "6px");
  await expect(week).toHaveCSS("background-color", surface);
  await expect(week).toHaveCSS("border-radius", "16px");
  const selected = week.locator(".circle.on");
  await expect(selected).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const future = week.locator("button:disabled .circle").first();
  await expect(future).toHaveCSS("color", muted);
  await expect(week.locator(".letter").first()).toHaveCSS("color", muted);
  const dot = week.locator(".dot.on");
  if (await dot.count()) await expect(dot.first()).toHaveCSS("background-color", muted);
}
