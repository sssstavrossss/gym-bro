import { execFileSync } from "node:child_process";
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

test("switching days keeps the current cards until the next day arrives", async ({ page }) => {
  const oid = `e2e-day-switch-${Date.now()}-${test.info().project.name}`;
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
  const yesterday = shift(when.today, -1);
  const weekdayOf = (iso: string) => page.evaluate((value) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(year, month - 1, day));
  }, iso);
  const yesterdayName = await weekdayOf(yesterday);
  const todayName = await weekdayOf(when.today);
  expect((await page.request.put(`/api/weigh-ins/${yesterday}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 84, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  execFileSync("psql", [
    "-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro",
    "-c", `UPDATE profiles SET created_at = created_at - interval '4 days' WHERE user_id = '${oid}'`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
  for (const [date, key, name, kcal] of [
    [when.today, "today", "Fictional today oats", 400],
    [yesterday, "yesterday", "Fictional yesterday roll", 700],
  ] as const) {
    const saved = await page.request.post("/api/log-entries", {
      headers: headers(oid),
      data: { idempotencyKey: `${oid}-${key}`, localDate: date, timeZone: when.zone, time: "08:15", name, kcal, protein: 10, fat: 5, carbs: 20 },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.route(/\/api\/log-entries\?date=/, async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    if (date === yesterday) await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await page.goto("/today");
  await expect(page.getByText("Fictional today oats")).toBeVisible();
  const before = await page.locator("main.today .macros").boundingBox();
  await page.getByRole("button", { name: new RegExp(yesterdayName) }).click();
  await expect(page.getByText("Fictional today oats")).toBeVisible();
  await expect(page.getByLabel("Loading today")).toHaveCount(0);
  const during = await page.locator("main.today .macros").boundingBox();
  expect(Math.abs((during?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
  await page.waitForTimeout(200);
  await expect(page.getByText("Fictional today oats")).toBeVisible();
  await expect(page.locator("[data-day-cards]")).toHaveCSS("opacity", "0.55");
  await expect(page.getByText("Fictional yesterday roll")).toBeVisible();
  await expect(page.getByText("Fictional today oats")).toHaveCount(0);
  await expect(page.locator("[data-day-cards]")).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: new RegExp(todayName) }).click();
  await expect(page.getByText("Fictional today oats")).toBeVisible();
  const revisit = Date.now();
  await page.getByRole("button", { name: new RegExp(yesterdayName) }).click();
  await expect(page.getByText("Fictional yesterday roll")).toBeVisible();
  expect(Date.now() - revisit).toBeLessThan(500);
  await expect(page.locator("[data-day-cards]")).toHaveCSS("opacity", "1");

  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Log" })).toBeVisible();
  await expect(page.getByText("Loading this day…")).toHaveCount(0);
  await expect(page.getByText("Fictional today oats")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(yesterdayName) }).click();
  await expect(page.getByText("Loading this day…")).toHaveCount(0);
  await expect(page.getByText("Fictional yesterday roll")).toBeVisible();
});
