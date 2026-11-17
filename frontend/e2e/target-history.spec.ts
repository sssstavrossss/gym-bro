import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Oslo" });

test("target history caps the list, labels months, and pages older rows from the server", async ({ page }) => {
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
  // 24 older rows a week apart: 25 in all, so the first page of 20 leaves 5 to load.
  const extra = Array.from({ length: 24 }, (_, index) => `INSERT INTO target_history (user_id, effective_date, bmr, tdee, formula_tdee, burn_sd_kcal, kcal, protein_grams, fat_grams, carb_grams, floor_applied, weight_kg, created_at, reasons)
    SELECT user_id, effective_date - ${(index + 1) * 7}, bmr, tdee, formula_tdee, burn_sd_kcal, kcal + ${index}, protein_grams, fat_grams, carb_grams, false, weight_kg, now(), '{macro_balance_change}' FROM target_history WHERE user_id = '${oid}' ORDER BY effective_date DESC LIMIT 1;`).join(" ");
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-c",
    `UPDATE profiles SET created_at = created_at - interval '200 days' WHERE user_id = '${oid}'; ${extra}`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/profile");
  const history = page.locator("[data-target-history]");
  await history.scrollIntoViewIfNeeded();
  await expect(history.getByText("25 changes")).toBeVisible();
  const list = history.locator("[data-history-list]");
  const rows = list.locator("[data-history-item='row']");
  await expect(rows).toHaveCount(20);
  // Months label the list; the newest month comes first.
  await expect(list.locator("[data-history-item='month']").first()).toBeVisible();
  expect(await list.locator("[data-history-item='month']").count()).toBeGreaterThan(2);
  // Six items show and the rest scroll inside the card.
  const size = await list.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(size.scroll).toBeGreaterThan(size.client);
  await expect(history.locator("[data-scroll-bar]")).toBeVisible();
  await expect(history.locator("[data-more-below]")).toBeVisible();

  await history.locator("[data-history-older]").click();
  await expect(rows).toHaveCount(25);
  await expect(history.locator("[data-history-older]")).toHaveCount(0);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(history.locator("[data-more-below]")).toBeHidden();
  await expect(history.locator("[data-more-above]")).toBeVisible();
  // The oldest row has nothing before it, so it shows its macros instead of a change.
  await expect(rows.last()).toContainText(/P\d+ · F\d+ · C\d+/);
  // Today's row has the same kcal as the one before it; the next one is 1 kcal under its own.
  await expect(rows.first()).toContainText("no change");
  await expect(rows.nth(1).locator("[data-change-chip]")).toHaveText("−1");
});
