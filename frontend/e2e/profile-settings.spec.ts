import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Oslo" });

function sql(statement: string) {
  execFileSync("psql", ["-h", "127.0.0.1", "-U", "gymbro", "-d", "gymbro", "-c", statement], { env: { ...process.env, PGPASSWORD: "gymbro" } });
}

test("profile: bell, cog, the Monday update marked new, and a time zone that follows the device", async ({ page }) => {
  const oid = `e2e-settings-${Date.now()}-${test.info().project.name}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  const headers = { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
  expect((await page.request.put(`/api/weigh-ins/${today}`, { headers, data: { kg: 83.6, timeZone: "UTC" } })).ok()).toBeTruthy();
  // Saved from another device in UTC. This browser is in Oslo, and the profile follows the device.
  expect((await page.request.put("/api/profile", {
    headers,
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: "UTC",
    },
  })).ok()).toBeTruthy();
  // Last week's row, then this Monday's update made after Profile was last seen, plus one unread note not shown on Home.
  sql(`UPDATE profiles SET created_at = created_at - interval '60 days', targets_seen_at = now() - interval '1 hour' WHERE user_id = '${oid}';
    INSERT INTO target_history (user_id, effective_date, bmr, tdee, kcal, protein_grams, fat_grams, carb_grams, floor_applied, weight_kg, created_at, reasons)
      SELECT user_id, effective_date - 7, bmr, tdee, kcal + 29, protein_grams, fat_grams, carb_grams, false, weight_kg, now() - interval '7 days', '{weekly_recalculation}' FROM target_history WHERE user_id = '${oid}';
    UPDATE target_history SET reasons = '{weekly_recalculation}', created_at = now() WHERE user_id = '${oid}' AND effective_date = '${today}';
    INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES ('${oid}', 'tip', 'Log a weigh-in', 'Two weigh-ins a week keep your trend accurate.', '/today', now());`);

  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
  await page.goto("/today");
  await expect(page.getByRole("link", { name: /Profile.*Unread/ })).toBeVisible();

  await page.getByRole("link", { name: /Profile/ }).click();
  const targets = page.locator("[data-targets]");
  await expect(targets.locator("[data-updated]")).toContainText("Updated");
  const strip = targets.locator("[data-target-change]");
  await expect(strip).toContainText("New");
  await expect(strip).toContainText("→");
  await expect(page.locator("[data-history-row][data-new]")).toHaveCount(1);
  await expect(page.locator("[data-goal-line]")).toContainText("kg to go");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/profile-settings-phone.png" });
  }

  // The Monday update has been seen now, on the account: a reload shows it as an ordinary row.
  await page.reload();
  await expect(page.locator("[data-targets]")).toBeVisible();
  await expect(page.locator("[data-target-change]")).toHaveCount(0);
  await expect(page.locator("[data-history-row][data-new]")).toHaveCount(0);

  // The bell still has the unread note. Opening it reads it.
  const bell = page.getByRole("button", { name: "Notifications, new" });
  await bell.click();
  const notes = page.getByRole("dialog", { name: "Notifications" });
  await expect(notes.locator("[data-note-list] li").first()).toContainText("Log a weigh-in");
  await expect(notes.getByRole("switch", { name: /Weekly recalculate reminder/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Unread/ })).toHaveCount(0);

  // Macro balance folds into Goal.
  await page.getByRole("button", { name: /Macro balance/ }).click();
  await expect(page.getByText("More carbs means less protein or fat.")).toBeVisible();

  // The cog: appearance, time zone, account, build.
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(settings.locator("[data-build]")).toBeVisible();
  const zoneRow = settings.locator("[data-zone-row]");
  await expect(zoneRow).toContainText("Europe/Oslo");
  await expect(zoneRow).toContainText("Follows this device");
  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/opt/cursor/artifacts/profile-settings-sheet.png" });
  }

  await zoneRow.click();
  const picker = page.getByRole("dialog", { name: "Time zone" });
  const search = picker.getByRole("searchbox", { name: "Search time zones" });
  expect(await search.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await search.fill("tokyo");
  await picker.getByRole("radio", { name: /Asia\/Tokyo/ }).click();
  await expect(zoneRow).toContainText("Asia/Tokyo");
  await expect(zoneRow).toContainText("Set by hand");
  let saved = await (await page.request.get("/api/profile", { headers })).json();
  expect(saved.profile.timeZone).toBe("Asia/Tokyo");
  expect(saved.profile.timeZoneFollowsDevice).toBe(false);
  const history = await (await page.request.get("/api/profile/history", { headers })).json();
  expect(history.rows).toHaveLength(2);

  // A zone set by hand stays after a reload on this device.
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("[data-zone-row]")).toContainText("Asia/Tokyo");
  await page.locator("[data-zone-row]").click();
  await page.getByRole("radio", { name: /Use this device/ }).click();
  await expect(page.locator("[data-zone-row]")).toContainText("Europe/Oslo");
  saved = await (await page.request.get("/api/profile", { headers })).json();
  expect(saved.profile.timeZone).toBe("Europe/Oslo");
  expect(saved.profile.timeZoneFollowsDevice).toBe(true);

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(fits).toBe(true);
});
