import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Oslo" });

test("target history shows five rows on one line each and scrolls the rest", async ({ page }) => {
  const oid = `e2e-history-${Date.now()}-${test.info().project.name}`;
  const zone = "Europe/Oslo";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${today}`, { headers, data: { kg: 83.6, timeZone: zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: zone,
    },
  })).ok()).toBeTruthy();
  const extra = [7, 14, 21, 28, 35, 42].map((ago, index) => `INSERT INTO target_history (user_id, effective_date, bmr, tdee, kcal, protein_grams, fat_grams, carb_grams, floor_applied, weight_kg, created_at, reasons)
    SELECT user_id, effective_date - ${ago}, bmr, tdee, kcal + ${index}, protein_grams, fat_grams, carb_grams, false, weight_kg, now(), '{macro_balance_change}' FROM target_history WHERE user_id = '${oid}' ORDER BY effective_date DESC LIMIT 1;`).join(" ");
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-c",
    `UPDATE profiles SET created_at = created_at - interval '60 days' WHERE user_id = '${oid}'; ${extra}`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/profile");
  const history = page.locator("[data-target-history]");
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText("7 changes")).toBeVisible();
  await expect(history.getByRole("button", { name: /Show all/ })).toHaveCount(0);
  const list = history.locator("[data-history-list]");
  await expect(list.locator("li")).toHaveCount(7);
  const size = await list.evaluate((el) => {
    const rows = [...el.querySelectorAll("li")].map((row) => row.getBoundingClientRect().height);
    return { client: el.clientHeight, scroll: el.scrollHeight, rows };
  });
  // One line per row at 375px: every row the same height, and five fill the box.
  // The last row has no bottom border, so it is a pixel shorter.
  expect(new Set(size.rows.slice(0, -1).map(Math.round)).size).toBe(1);
  expect(size.scroll).toBeGreaterThan(size.client);
  expect(Math.round(size.client / size.rows[0])).toBe(5);
  await expect(history.locator("[data-scroll-bar]")).toBeVisible();
  await expect(history.locator("[data-more-below]")).toBeVisible();
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(history.locator("[data-more-below]")).toBeHidden();
  await expect(history.locator("[data-more-above]")).toBeVisible();
});
